-- =====================================================
-- SECURITY SETUP: Application role creation
-- =====================================================
-- The Docker image creates POSTGRES_USER (notesuser) as SUPERUSER by default.
-- The notesapp role is created by 00-create-app-role.sh (runs first)
-- with password from DATABASE_URL environment variable.
-- This ensures password is only stored in .env file, not hardcoded here.
--
-- Note: notesapp is created WITHOUT SUPERUSER and WITHOUT BYPASSRLS
-- This ensures RLS policies are enforced for the application
-- =====================================================
-- Enable extensions
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For additional encryption functions

-- Create users table with UUIDs
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(512) NOT NULL,
    failed_login_attempts INT DEFAULT 0,
    last_failed_login TIMESTAMP,
    account_locked_until TIMESTAMP,
    password_changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    profile_picture VARCHAR(255),
    deleted_at TIMESTAMP,
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT username_length CHECK (LENGTH(username) >= 3),
    CONSTRAINT valid_failed_attempts CHECK (failed_login_attempts >= 0 AND failed_login_attempts <= 100),
    CONSTRAINT valid_lock_time CHECK (account_locked_until IS NULL OR account_locked_until > last_failed_login),
    CONSTRAINT valid_user_deletion CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX unique_lower_email ON users (LOWER(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX unique_lower_username ON users (LOWER(username)) WHERE deleted_at IS NULL;

-- Create refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP,
    revoked_reason VARCHAR(100),
    device_fingerprint VARCHAR(255),
    ip_address INET,
    CONSTRAINT valid_expiry CHECK (expires_at > created_at),
    CONSTRAINT valid_revocation CHECK (
        (revoked = false AND revoked_at IS NULL) OR
        (revoked = true AND revoked_at IS NOT NULL) OR
        (revoked IS NULL AND revoked_at IS NULL)
    )
);

-- Create notes table
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT content_length CHECK (LENGTH(content) <= 1000000),
    CONSTRAINT valid_note_deletion CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

-- Create audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT details_size CHECK (pg_column_size(details) <= 65536)
);

-- Friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    UNIQUE(user_id, friend_id),
    CHECK (user_id != friend_id),
    CONSTRAINT valid_friendship_status CHECK (status IN ('pending', 'accepted', 'blocked')),
    CONSTRAINT valid_accepted_time CHECK (accepted_at IS NULL OR accepted_at >= requested_at)
);

-- Note shares table
CREATE TABLE IF NOT EXISTS note_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(10) DEFAULT 'read',
    shared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(note_id, shared_with_id),
    CONSTRAINT valid_share_permission CHECK (permission IN ('read', 'write', 'admin')),
    CONSTRAINT valid_share_users CHECK (owner_id != shared_with_id)
);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    attempt_count INT DEFAULT 1,
    window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    blocked_until TIMESTAMP,
    UNIQUE(identifier, action)
);

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    user_id UUID REFERENCES users(id),
    ip_address INET,
    details JSONB,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);


-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    related_id UUID,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (type IN ('friend_request', 'friend_accepted', 'note_shared', 'note_unshared', 'note_left', 'share_permission_updated'))
);

-- Indexes
CREATE INDEX idx_notes_user_id ON notes(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_created_at ON notes(created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token) WHERE NOT revoked;
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE NOT revoked;

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

CREATE INDEX idx_friendships_user ON friendships(user_id);
CREATE INDEX idx_friendships_friend ON friendships(friend_id);
CREATE INDEX idx_friendships_status ON friendships(status);

CREATE INDEX idx_note_shares_note ON note_shares(note_id);
CREATE INDEX idx_note_shares_shared_with ON note_shares(shared_with_id);
CREATE INDEX idx_note_shares_owner ON note_shares(owner_id);

CREATE INDEX idx_rate_limits_lookup ON rate_limits(identifier, action, window_start);

CREATE INDEX idx_security_events_unresolved ON security_events(created_at) WHERE NOT resolved;

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_from_user_id ON notifications(from_user_id) WHERE from_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Index for security events user lookups
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id) WHERE user_id IS NOT NULL;

-- Covering index for share count queries (optimizes correlated subqueries)
CREATE INDEX IF NOT EXISTS idx_note_shares_note_id_covering ON note_shares(note_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_friendships_user_status
ON friendships(user_id, status, friend_id, requested_at, accepted_at);

CREATE INDEX IF NOT EXISTS idx_friendships_friend_status
ON friendships(friend_id, status, user_id, requested_at, accepted_at);

CREATE INDEX IF NOT EXISTS idx_note_shares_shared_permission
ON note_shares(shared_with_id, permission, note_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
ON refresh_tokens(user_id, expires_at)
WHERE NOT revoked;

CREATE INDEX IF NOT EXISTS idx_security_events_severity_unresolved
ON security_events(severity, created_at DESC)
WHERE NOT resolved;

CREATE INDEX IF NOT EXISTS idx_notes_user_updated
ON notes(user_id, updated_at DESC, id, title, encrypted)
WHERE deleted_at IS NULL;

-- Enable Row Level Security
-- FORCE applies RLS even to table owners (required for proper testing and security)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;

ALTER TABLE note_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_shares FORCE ROW LEVEL SECURITY;

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships FORCE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- RLS Policies (examples - adjust based on your app's auth mechanism)
-- Note: You'll need to set current_setting('app.user_id') in your application

-- Notes policies: Optimized with EXISTS for better performance
CREATE POLICY notes_owner_select_policy ON notes
    FOR SELECT
    USING (user_id = current_setting('app.user_id', true)::UUID AND deleted_at IS NULL);

CREATE POLICY notes_owner_update_policy ON notes
    FOR UPDATE
    USING (user_id = current_setting('app.user_id', true)::UUID AND deleted_at IS NULL)
    WITH CHECK (user_id = current_setting('app.user_id', true)::UUID);

CREATE POLICY notes_owner_delete_policy ON notes
    FOR DELETE
    USING (user_id = current_setting('app.user_id', true)::UUID);

CREATE POLICY notes_owner_insert_policy ON notes
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.user_id', true)::UUID);

-- Shared notes SELECT policy (using EXISTS for better performance)
CREATE POLICY notes_shared_select_policy ON notes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM note_shares
            WHERE note_id = notes.id
            AND shared_with_id = current_setting('app.user_id', true)::UUID
        ) AND deleted_at IS NULL
    );

-- Shared notes UPDATE policy (only for users with 'write' permission)
CREATE POLICY notes_shared_update_policy ON notes
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM note_shares
            WHERE note_id = notes.id
            AND shared_with_id = current_setting('app.user_id', true)::UUID
            AND permission = 'write'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM note_shares
            WHERE note_id = notes.id
            AND shared_with_id = current_setting('app.user_id', true)::UUID
            AND permission = 'write'
        )
    );

-- Note shares policies: Separate policies for each operation to allow proper sharing flow
-- SELECT: Users can see shares they own or are shared with
CREATE POLICY note_shares_select_policy ON note_shares
    FOR SELECT
    USING (
        owner_id = current_setting('app.user_id', true)::UUID
        OR shared_with_id = current_setting('app.user_id', true)::UUID
    );

-- INSERT: Allow owners to create shares (owner_id must be current user)
CREATE POLICY note_shares_insert_policy ON note_shares
    FOR INSERT
    WITH CHECK (owner_id = current_setting('app.user_id', true)::UUID);

-- UPDATE: Allow owners to update shares
CREATE POLICY note_shares_update_policy ON note_shares
    FOR UPDATE
    USING (owner_id = current_setting('app.user_id', true)::UUID)
    WITH CHECK (owner_id = current_setting('app.user_id', true)::UUID);

-- DELETE: Allow owners to delete shares, or users can remove shares they're part of
CREATE POLICY note_shares_delete_policy ON note_shares
    FOR DELETE
    USING (
        owner_id = current_setting('app.user_id', true)::UUID
        OR shared_with_id = current_setting('app.user_id', true)::UUID
    );

-- Friendships policies: Separate policies for each operation to allow proper friend request flow
-- SELECT: Users can see friendships they're part of
CREATE POLICY friendships_select_policy ON friendships
    FOR SELECT
    USING (
        user_id = current_setting('app.user_id', true)::UUID
        OR friend_id = current_setting('app.user_id', true)::UUID
    );

-- INSERT: Allow users to create friend requests where they are the requester (user_id)
CREATE POLICY friendships_insert_policy ON friendships
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.user_id', true)::UUID);

-- UPDATE: Users can update friendships they're part of (accepting requests)
CREATE POLICY friendships_update_policy ON friendships
    FOR UPDATE
    USING (
        user_id = current_setting('app.user_id', true)::UUID
        OR friend_id = current_setting('app.user_id', true)::UUID
    )
    WITH CHECK (
        user_id = current_setting('app.user_id', true)::UUID
        OR friend_id = current_setting('app.user_id', true)::UUID
    );

-- DELETE: Users can delete friendships they're part of
CREATE POLICY friendships_delete_policy ON friendships
    FOR DELETE
    USING (
        user_id = current_setting('app.user_id', true)::UUID
        OR friend_id = current_setting('app.user_id', true)::UUID
    );

-- Notifications policies: Separate policies to allow cross-user notification creation
-- SELECT: Users can see their own notifications
CREATE POLICY notifications_select_policy ON notifications
    FOR SELECT
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- INSERT: Allow creating notifications for any user (controlled by application logic)
CREATE POLICY notifications_insert_policy ON notifications
    FOR INSERT
    WITH CHECK (true);

-- UPDATE: Users can only update their own notifications (marking as read)
CREATE POLICY notifications_update_policy ON notifications
    FOR UPDATE
    USING (user_id = current_setting('app.user_id', true)::UUID)
    WITH CHECK (user_id = current_setting('app.user_id', true)::UUID);

-- DELETE: Users can only delete their own notifications
CREATE POLICY notifications_delete_policy ON notifications
    FOR DELETE
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- Refresh tokens policies: Split into separate operations for better control
-- SELECT: Users can only see their own tokens
CREATE POLICY refresh_tokens_select_policy ON refresh_tokens
    FOR SELECT
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- INSERT: Allow system operations (registration/login) when app.user_id is not set
-- This enables executeAsSystem() to create tokens during registration
CREATE POLICY refresh_tokens_insert_policy ON refresh_tokens
    FOR INSERT
    WITH CHECK (
        current_setting('app.user_id', true) IS NULL
        OR user_id = current_setting('app.user_id', true)::UUID
    );

-- UPDATE: Allow system operations to revoke tokens (logout, new login)
CREATE POLICY refresh_tokens_update_policy ON refresh_tokens
    FOR UPDATE
    USING (
        current_setting('app.user_id', true) IS NULL
        OR user_id = current_setting('app.user_id', true)::UUID
    )
    WITH CHECK (
        current_setting('app.user_id', true) IS NULL
        OR user_id = current_setting('app.user_id', true)::UUID
    );

-- DELETE: Only allow if user_id matches (or system operation)
CREATE POLICY refresh_tokens_delete_policy ON refresh_tokens
    FOR DELETE
    USING (
        current_setting('app.user_id', true) IS NULL
        OR user_id = current_setting('app.user_id', true)::UUID
    );

-- Audit logs policies: Users can read their own audit logs (read-only)
CREATE POLICY audit_logs_read_policy ON audit_logs
    FOR SELECT
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- INSERT: Allow system to write audit logs (registration, login, etc.)
CREATE POLICY audit_logs_insert_policy ON audit_logs
    FOR INSERT
    WITH CHECK (true);

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    -- Security: Only update if called by trigger
    IF TG_OP != 'UPDATE' THEN
        RAISE EXCEPTION 'This function can only be called by UPDATE trigger';
    END IF;

    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Revoke public execution
REVOKE ALL ON FUNCTION update_updated_at_column() FROM PUBLIC;

-- Trigger for automatic cleanup of expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS TABLE(deleted_count BIGINT) AS $$
DECLARE
    v_deleted BIGINT;
BEGIN
    -- Delete expired tokens older than 30 days
    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP
    AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- Log the cleanup operation
    INSERT INTO audit_logs (user_id, action, resource_type, details)
    VALUES (
        NULL,
        'token_cleanup',
        'refresh_tokens',
        jsonb_build_object('deleted_count', v_deleted, 'executed_at', CURRENT_TIMESTAMP)
    );

    RETURN QUERY SELECT v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Revoke public execution and grant to database user
REVOKE ALL ON FUNCTION cleanup_expired_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_tokens() TO notesuser;

-- Triggers
CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Additional maintenance functions
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS BIGINT AS $$
DECLARE
    v_deleted BIGINT;
BEGIN
    -- Delete rate limit records older than 24 hours
    -- Only removes expired windows and blocks that are no longer active
    -- This prevents table bloat while maintaining active rate limit state
    DELETE FROM rate_limits
    WHERE window_start < CURRENT_TIMESTAMP - INTERVAL '24 hours'
    AND (blocked_until IS NULL OR blocked_until < CURRENT_TIMESTAMP);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- Log the cleanup operation for audit trail
    INSERT INTO audit_logs (user_id, action, resource_type, details)
    VALUES (
        NULL,
        'rate_limit_cleanup',
        'rate_limits',
        jsonb_build_object('deleted_count', v_deleted, 'executed_at', CURRENT_TIMESTAMP)
    );

    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Revoke public execution and grant to database user
REVOKE ALL ON FUNCTION cleanup_old_rate_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits() TO notesuser;

-- =====================================================
-- GRANT PERMISSIONS TO APPLICATION ROLE (notesapp)
-- =====================================================
-- Grant necessary database and schema access
GRANT CONNECT ON DATABASE notesdb TO notesapp;
GRANT USAGE ON SCHEMA public TO notesapp;

-- Grant table permissions (SELECT, INSERT, UPDATE, DELETE only - no DDL)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO notesapp;

-- Grant sequence permissions (for UUID generation and auto-increment columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO notesapp;

-- Grant execute on specific maintenance functions
GRANT EXECUTE ON FUNCTION cleanup_expired_tokens() TO notesapp;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits() TO notesapp;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO notesapp;

-- Set default privileges for future objects (in case tables are added later)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notesapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO notesapp;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO notesapp;

-- =====================================================
-- SECURITY VERIFICATION
-- =====================================================
-- Verify notesapp doesn't have dangerous privileges
DO $$
DECLARE
    v_super BOOLEAN;
    v_bypassrls BOOLEAN;
BEGIN
    SELECT rolsuper, rolbypassrls INTO v_super, v_bypassrls
    FROM pg_roles WHERE rolname = 'notesapp';

    IF v_super OR v_bypassrls THEN
        RAISE EXCEPTION 'SECURITY ERROR: notesapp has dangerous privileges (SUPERUSER: %, BYPASSRLS: %)', v_super, v_bypassrls;
    ELSE
        RAISE NOTICE '✓ Security check passed: notesapp role configured correctly';
    END IF;
END $$;

-- Verify RLS is enabled on critical tables
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM pg_tables t
    JOIN pg_class c ON t.tablename = c.relname
    WHERE t.schemaname = 'public'
    AND t.tablename IN ('notes', 'note_shares', 'friendships', 'notifications')
    AND c.relrowsecurity = true
    AND c.relforcerowsecurity = true;

    IF v_count != 4 THEN
        RAISE EXCEPTION 'SECURITY ERROR: RLS not enabled on all critical tables (enabled on % of 4)', v_count;
    ELSE
        RAISE NOTICE '✓ RLS verification passed: All critical tables have forced row security enabled';
    END IF;
END $$;

-- Verify RLS policies exist
DO $$
DECLARE
    v_policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename IN ('notes', 'note_shares', 'friendships', 'notifications', 'refresh_tokens', 'audit_logs');

    IF v_policy_count < 20 THEN
        RAISE WARNING 'RLS policies may be incomplete (found % policies, expected 20+)', v_policy_count;
    ELSE
        RAISE NOTICE '✓ RLS policies verified: % policies found', v_policy_count;
    END IF;
END $$;