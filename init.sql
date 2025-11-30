-- Enable extensions
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

-- Composite indexes for common query patterns (with INCLUDE for covering indexes)
CREATE INDEX IF NOT EXISTS idx_friendships_user_status
ON friendships(user_id, status)
INCLUDE (friend_id, requested_at, accepted_at);

CREATE INDEX IF NOT EXISTS idx_friendships_friend_status
ON friendships(friend_id, status)
INCLUDE (user_id, requested_at, accepted_at);

CREATE INDEX IF NOT EXISTS idx_note_shares_shared_permission
ON note_shares(shared_with_id, permission)
INCLUDE (note_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
ON refresh_tokens(user_id, expires_at)
WHERE NOT revoked;

CREATE INDEX IF NOT EXISTS idx_security_events_severity_unresolved
ON security_events(severity, created_at DESC)
WHERE NOT resolved;

CREATE INDEX IF NOT EXISTS idx_notes_user_updated
ON notes(user_id, updated_at DESC)
WHERE deleted_at IS NULL
INCLUDE (id, title, encrypted);

-- Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

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

-- Note shares policies: Users can see shares they own or are shared with
CREATE POLICY note_shares_access_policy ON note_shares
    FOR ALL
    USING (
        owner_id = current_setting('app.user_id', true)::UUID
        OR shared_with_id = current_setting('app.user_id', true)::UUID
    );

-- Friendships policies: Users can see friendships they're part of
CREATE POLICY friendships_access_policy ON friendships
    FOR ALL
    USING (
        user_id = current_setting('app.user_id', true)::UUID
        OR friend_id = current_setting('app.user_id', true)::UUID
    );

-- Notifications policies: Users can only see their own notifications
CREATE POLICY notifications_owner_policy ON notifications
    FOR ALL
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- Refresh tokens policies: Users can only see their own tokens
CREATE POLICY refresh_tokens_owner_policy ON refresh_tokens
    FOR ALL
    USING (user_id = current_setting('app.user_id', true)::UUID);

-- Audit logs policies: Users can read their own audit logs (read-only)
CREATE POLICY audit_logs_read_policy ON audit_logs
    FOR SELECT
    USING (user_id = current_setting('app.user_id', true)::UUID);

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

-- Monitoring Views
CREATE OR REPLACE VIEW v_user_statistics AS
SELECT
    u.id,
    u.username,
    u.email,
    u.created_at,
    u.last_login,
    COUNT(DISTINCT n.id) FILTER (WHERE n.deleted_at IS NULL) as note_count,
    COUNT(DISTINCT ns.id) as shared_note_count,
    COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'accepted') as friend_count
FROM users u
LEFT JOIN notes n ON u.id = n.user_id
LEFT JOIN note_shares ns ON u.id = ns.shared_with_id
LEFT JOIN friendships f ON u.id = f.user_id OR u.id = f.friend_id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.username, u.email, u.created_at, u.last_login;

-- View: Table sizes and row counts
CREATE OR REPLACE VIEW v_table_statistics AS
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size,
    n_live_tup as estimated_rows,
    n_dead_tup as dead_rows,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- View: Security event summary
CREATE OR REPLACE VIEW v_security_summary AS
SELECT
    event_type,
    severity,
    COUNT(*) as event_count,
    COUNT(*) FILTER (WHERE NOT resolved) as unresolved_count,
    MIN(created_at) as first_occurrence,
    MAX(created_at) as last_occurrence
FROM security_events
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY event_type, severity
ORDER BY severity DESC, event_count DESC;

-- View: Index usage statistics
CREATE OR REPLACE VIEW v_index_usage AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;