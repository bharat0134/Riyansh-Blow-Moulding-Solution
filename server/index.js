const fs = require('fs');
const path = require('path');
const express = require('express');
const { openDb, initSchema, dbPath } = require('./db');

const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = openDb();
initSchema(db);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function nextDispatchNo() {
  const row = db
    .prepare(
      `SELECT dispatch_no FROM dispatches
       ORDER BY id DESC LIMIT 1`
    )
    .get();
  if (!row) return 'DSP-0001';
  const match = row.dispatch_no.match(/DSP-(\d+)/);
  const num = match ? parseInt(match[1], 10) + 1 : 1;
  return `DSP-${String(num).padStart(4, '0')}`;
}

// --- Customer master ---
app.get('/api/customers', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, phone, address FROM customers ORDER BY name')
    .all();
  res.json(rows);
});

app.post('/api/customers', (req, res) => {
  const { name, phone, address } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  try {
    const result = db
      .prepare(
        'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)'
      )
      .run(String(name).trim(), phone || null, address || null);
    const row = db
      .prepare('SELECT id, name, phone, address FROM customers WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Customer name already exists' });
    }
    throw e;
  }
});

// --- Product master ---
app.get('/api/products', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, name, sku, unit, stock_qty FROM products ORDER BY name'
    )
    .all();
  res.json(rows);
});

app.post('/api/products', (req, res) => {
  const { name, sku, unit, stock_qty } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const qty = Number(stock_qty);
  if (Number.isNaN(qty) || qty < 0) {
    return res.status(400).json({ error: 'Invalid stock quantity' });
  }
  try {
    const result = db
      .prepare(
        'INSERT INTO products (name, sku, unit, stock_qty) VALUES (?, ?, ?, ?)'
      )
      .run(
        String(name).trim(),
        sku || null,
        unit || 'pcs',
        qty
      );
    const row = db
      .prepare(
        'SELECT id, name, sku, unit, stock_qty FROM products WHERE id = ?'
      )
      .get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Product name already exists' });
    }
    throw e;
  }
});

app.patch('/api/products/:id/stock', (req, res) => {
  const id = Number(req.params.id);
  const { stock_qty } = req.body;
  const qty = Number(stock_qty);
  if (Number.isNaN(qty) || qty < 0) {
    return res.status(400).json({ error: 'Invalid stock quantity' });
  }
  const result = db
    .prepare('UPDATE products SET stock_qty = ? WHERE id = ?')
    .run(qty, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const row = db
    .prepare(
      'SELECT id, name, sku, unit, stock_qty FROM products WHERE id = ?'
    )
    .get(id);
  res.json(row);
});

// --- Dispatch (manual entry) ---
app.get('/api/dispatches', (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.dispatch_no, d.customer_id, c.name AS customer_name,
              d.vehicle_no, d.notes, d.dispatched_at
       FROM dispatches d
       JOIN customers c ON c.id = d.customer_id
       ORDER BY d.id DESC
       LIMIT 100`
    )
    .all();
  res.json(rows);
});

app.get('/api/dispatches/:id', (req, res) => {
  const id = Number(req.params.id);
  const dispatch = db
    .prepare(
      `SELECT d.id, d.dispatch_no, d.customer_id, c.name AS customer_name,
              c.phone AS customer_phone, c.address AS customer_address,
              d.vehicle_no, d.notes, d.dispatched_at
       FROM dispatches d
       JOIN customers c ON c.id = d.customer_id
       WHERE d.id = ?`
    )
    .get(id);
  if (!dispatch) {
    return res.status(404).json({ error: 'Dispatch not found' });
  }
  const items = db
    .prepare(
      `SELECT di.id, di.product_id, p.name AS product_name, p.sku, p.unit,
              di.quantity
       FROM dispatch_items di
       JOIN products p ON p.id = di.product_id
       WHERE di.dispatch_id = ?`
    )
    .all(id);
  res.json({ ...dispatch, items });
});

app.post('/api/dispatches', (req, res) => {
  const { customer_id, vehicle_no, notes, items } = req.body;
  const customerId = Number(customer_id);
  if (!customerId) {
    return res.status(400).json({ error: 'Customer is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one product line is required' });
  }

  const customer = db
    .prepare('SELECT id FROM customers WHERE id = ?')
    .get(customerId);
  if (!customer) {
    return res.status(400).json({ error: 'Invalid customer' });
  }

  const normalized = [];
  for (const line of items) {
    const productId = Number(line.product_id);
    const qty = Number(line.quantity);
    if (!productId || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Invalid product or quantity in line' });
    }
    normalized.push({ product_id: productId, quantity: qty });
  }

  const createDispatch = db.transaction(() => {
    for (const line of normalized) {
      const product = db
        .prepare('SELECT id, name, stock_qty FROM products WHERE id = ?')
        .get(line.product_id);
      if (!product) {
        const err = new Error('PRODUCT_NOT_FOUND');
        err.productId = line.product_id;
        throw err;
      }
      if (product.stock_qty < line.quantity) {
        const err = new Error('INSUFFICIENT_STOCK');
        err.productName = product.name;
        err.available = product.stock_qty;
        err.requested = line.quantity;
        throw err;
      }
    }

    const dispatchNo = nextDispatchNo();
    const dispatchResult = db
      .prepare(
        `INSERT INTO dispatches (dispatch_no, customer_id, vehicle_no, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(dispatchNo, customerId, vehicle_no || null, notes || null);

    const dispatchId = dispatchResult.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO dispatch_items (dispatch_id, product_id, quantity)
       VALUES (?, ?, ?)`
    );
    const updateStock = db.prepare(
      `UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?`
    );

    for (const line of normalized) {
      insertItem.run(dispatchId, line.product_id, line.quantity);
      updateStock.run(line.quantity, line.product_id);
    }

    return dispatchId;
  });

  try {
    const dispatchId = createDispatch();
    const full = db
      .prepare(
        `SELECT d.id, d.dispatch_no, d.customer_id, c.name AS customer_name,
                d.vehicle_no, d.notes, d.dispatched_at
         FROM dispatches d
         JOIN customers c ON c.id = d.customer_id
         WHERE d.id = ?`
      )
      .get(dispatchId);
    const dispatchItems = db
      .prepare(
        `SELECT di.product_id, p.name AS product_name, p.unit, di.quantity
         FROM dispatch_items di
         JOIN products p ON p.id = di.product_id
         WHERE di.dispatch_id = ?`
      )
      .all(dispatchId);
    res.status(201).json({ ...full, items: dispatchItems });
  } catch (e) {
    if (e.message === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({
        error: `Insufficient stock for "${e.productName}". Available: ${e.available}, requested: ${e.requested}`,
      });
    }
    if (e.message === 'PRODUCT_NOT_FOUND') {
      return res.status(400).json({ error: 'One or more products are invalid' });
    }
    throw e;
  }
});

app.get('/api/dispatches/next-no', (_req, res) => {
  res.json({ dispatch_no: nextDispatchNo() });
});

app.listen(PORT, () => {
  console.log(`Riyansh Dispatch running at http://localhost:${PORT}`);
});
