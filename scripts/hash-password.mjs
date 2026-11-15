// Usage: node scripts/hash-password.mjs "your-new-admin-password"
// Prints a value for the ADMIN_PASSWORD_HASH environment variable.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: node scripts/hash-password.mjs "a password of at least 10 characters"');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
console.log(`pbkdf2-sha256$${salt.toString("hex")}$${hash.toString("hex")}`);
