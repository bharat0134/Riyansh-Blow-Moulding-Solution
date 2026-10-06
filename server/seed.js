const fs = require('fs');
const path = require('path');
const { openDb, initSchema, dbPath } = require('./db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = openDb();
initSchema(db);

const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
if (customerCount === 0) {
  const insertCustomer = db.prepare(
    'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)'
  );
  insertCustomer.run('Sharma Plastics Pvt Ltd', '9876543210', 'Delhi');
  insertCustomer.run('Gupta Industries', '9123456780', 'Noida');
  insertCustomer.run('Bharat Trading Co.', '9988776655', 'Ghaziabad');
}

const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (productCount === 0) {
  const insertProduct = db.prepare(
    'INSERT INTO products (name, sku, unit, stock_qty) VALUES (?, ?, ?, ?)'
  );
  insertProduct.run('20L HDPE Jar', 'JAR-20L', 'pcs', 500);
  insertProduct.run('5L Bottle', 'BTL-5L', 'pcs', 1200);
  insertProduct.run('Caps 28mm', 'CAP-28', 'pcs', 10000);
}

db.close();
console.log('Seed complete:', dbPath);
