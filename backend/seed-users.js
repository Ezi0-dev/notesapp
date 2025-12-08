const argon2 = require('argon2');
const { pool } = require('./src/config/database');

/**
 * Seed script to create initial users for development
 * Run with: node seed-users.js
 * Safe to run multiple times (checks if users exist first)
 */

const seedUsers = [
  {
    username: 'admin',
    email: 'admin@example.com',
    password: 'Admin123!',
    role: 'admin'
  },
  {
    username: 'testuser1',
    email: 'user1@example.com',
    password: 'User123!',
    role: 'user'
  },
  {
    username: 'testuser2',
    email: 'user2@example.com',
    password: 'User123!',
    role: 'user'
  }
];

async function createUser(userData) {
  const { username, email, password, role } = userData;

  try {
    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      console.log(`⏭️  Skipping ${username} (already exists)`);
      return;
    }

    // Hash password
    const passwordHash = await argon2.hash(password);

    // Insert user
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role',
      [username, email, passwordHash, role]
    );

    console.log(`✅ Created ${role} user: ${username} (${email})`);
  } catch (error) {
    console.error(`❌ Failed to create ${username}:`, error.message);
  }
}

async function seed() {
  console.log('========================================');
  console.log('  Seeding Development Users');
  console.log('========================================\n');

  try {
    // Create all users
    for (const userData of seedUsers) {
      await createUser(userData);
    }

    console.log('\n========================================');
    console.log('  Seeding Complete!');
    console.log('========================================');
    console.log('\n💡 Default credentials:');
    console.log('   Admin: admin / Admin123!');
    console.log('   User1: testuser1 / User123!');
    console.log('   User2: testuser2 / User123!\n');
    console.log('⚠️  Remember to change these passwords!\n');

  } catch (error) {
    console.error('Fatal error during seeding:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the seed
seed();
