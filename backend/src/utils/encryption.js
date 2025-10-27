const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const HMAC_ALGORITHM = 'sha256';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const HMAC_KEY = Buffer.from(process.env.HMAC_KEY, 'hex');

if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required!');
}

if (!process.env.HMAC_KEY) {
  throw new Error('HMAC_KEY environment variable is required!');
}

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}

if (HMAC_KEY.length !== 32) {
  throw new Error('HMAC_KEY must be 64 hex characters (32 bytes)');
}

function encrypt(text) {
  // Handle null/undefined/empty input
  if (!text) {
    throw new Error('Cannot encrypt empty or null text');
  }

  // Ensure text is a string
  if (typeof text !== 'string') {
    throw new Error('encrypt() requires a string input');
  }

  try {
    // Generate random IV (Initialization Vector)
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Create message to authenticate: IV + encrypted data
    const message = iv.toString('hex') + ':' + encrypted;
    
    // Generate HMAC for integrity verification
    const hmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY);
    hmac.update(message);
    const authTag = hmac.digest('hex');
    
    // Return format: iv:ciphertext:hmac
    return message + ':' + authTag;
    
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

function decrypt(text) {
  // Handle null/undefined/empty input
  if (!text) {
    throw new Error('Cannot decrypt empty or null text');
  }

  // Ensure text is a string
  if (typeof text !== 'string') {
    throw new Error('decrypt() requires a string input');
  }

  try {
    // Parse the encrypted format: iv:ciphertext:hmac
    const parts = text.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format - expected iv:ciphertext:hmac');
    }
    
    const [ivHex, encryptedHex, receivedAuthTag] = parts;
    
    // Validate hex encoding
    if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(encryptedHex) || !/^[0-9a-f]+$/i.test(receivedAuthTag)) {
      throw new Error('Invalid encrypted data format - data is not properly hex-encoded');
    }
    
    // Reconstruct the authenticated message
    const message = ivHex + ':' + encryptedHex;
    
    // Calculate expected HMAC
    const hmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY);
    hmac.update(message);
    const expectedAuthTag = hmac.digest('hex');
    
    // Verify HMAC using constant-time comparison (prevents timing attacks)
    const receivedAuthTagBuffer = Buffer.from(receivedAuthTag, 'hex');
    const expectedAuthTagBuffer = Buffer.from(expectedAuthTag, 'hex');
    
    if (receivedAuthTagBuffer.length !== expectedAuthTagBuffer.length) {
      throw new Error('Data integrity verification failed - authentication tag length mismatch');
    }
    
    if (!crypto.timingSafeEqual(receivedAuthTagBuffer, expectedAuthTagBuffer)) {
      throw new Error('Data integrity verification failed - possible tampering detected');
    }
    
    // HMAC verified successfully - proceed with decryption
    const iv = Buffer.from(ivHex, 'hex');
    
    // Validate IV length
    if (iv.length !== 16) {
      throw new Error('Invalid IV length - expected 16 bytes');
    }
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
    
  } catch (error) {
    // Re-throw with context
    if (error.message.includes('integrity verification failed')) {
      // This is a security issue - don't mask it
      throw error;
    } else if (error.message.includes('bad decrypt')) {
      // Wrong key or corrupted data
      throw new Error('Decryption failed - incorrect encryption key or corrupted data');
    } else {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
}

module.exports = { encrypt, decrypt };