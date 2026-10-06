const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
};

let customersCache = [];
let productsCache = [];

function showMessage(elId, text, type = 'success') {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `message ${type}`;
  el.hidden = false;
}

function hideMessage(elId) {
  document.getElementById(elId).hidden = true;
}

// Tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.remove('active');
      p.hidden = true;
    });
    btn.classList.add('active');
    const panel = document.getElementById(`panel-${btn.dataset.tab}`);
    panel.hidden = false;
    panel.classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'customers') loadCustomersTable();
    if (btn.dataset.tab === 'products') loadProductsTable();
  });
});

async function loadMasters() {
  [customersCache, productsCache] = await Promise.all([
    api.get('/api/customers'),
    api.get('/api/products'),
  ]);
  fillCustomerSelect();
  renderAllLineRows();
}

function fillCustomerSelect() {
  const sel = document.getElementById('dispatch-customer');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select customer —</option>';
  for (const c of customersCache) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

function productOptionsHtml(selectedId = '') {
  return (
    '<option value="">— Select product —</option>' +
    productsCache
      .map(
        (p) =>
          `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.name)} (${p.stock_qty} ${p.unit})</option>`
      )
      .join('')
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stockForProduct(productId) {
  const p = productsCache.find((x) => x.id === Number(productId));
  return p ? p.stock_qty : '—';
}

function unitForProduct(productId) {
  const p = productsCache.find((x) => x.id === Number(productId));
  return p ? p.unit : '';
}

function createLineRow(productId = '', qty = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="line-product" required>${productOptionsHtml(productId)}</select>
    </td>
    <td class="stock-cell" data-stock>—</td>
    <td>
      <input type="number" class="line-qty" min="0.001" step="any" value="${qty}" required placeholder="Qty" />
    </td>
    <td><button type="button" class="btn ghost remove-line">Remove</button></td>
  `;
  const productSel = tr.querySelector('.line-product');
  const updateStockCell = () => {
    const cell = tr.querySelector('[data-stock]');
    const id = productSel.value;
    const stock = stockForProduct(id);
    cell.textContent = id ? `${stock} ${unitForProduct(id)}` : '—';
    cell.classList.toggle('low', id && Number(stock) <= 0);
  };
  productSel.addEventListener('change', updateStockCell);
  updateStockCell();
  tr.querySelector('.remove-line').addEventListener('click', () => {
    const body = document.getElementById('lines-body');
    if (body.children.length > 1) tr.remove();
  });
  return tr;
}

function renderAllLineRows() {
  const body = document.getElementById('lines-body');
  const rows = [...body.querySelectorAll('tr')].map((tr) => ({
    productId: tr.querySelector('.line-product')?.value,
    qty: tr.querySelector('.line-qty')?.value,
  }));
  body.innerHTML = '';
  if (rows.length === 0) {
    body.appendChild(createLineRow());
    return;
  }
  for (const r of rows) {
    body.appendChild(createLineRow(r.productId, r.qty));
  }
}

document.getElementById('add-line').addEventListener('click', () => {
  document.getElementById('lines-body').appendChild(createLineRow());
});

async function refreshNextDispatchNo() {
  const { dispatch_no } = await api.get('/api/dispatches/next-no');
  document.getElementById('dispatch-no').value = dispatch_no;
}

document.getElementById('dispatch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage('dispatch-message');
  const customer_id = document.getElementById('dispatch-customer').value;
  const vehicle_no = document.getElementById('dispatch-vehicle').value.trim();
  const notes = document.getElementById('dispatch-notes').value.trim();
  const items = [];
  document.querySelectorAll('#lines-body tr').forEach((tr) => {
    const product_id = tr.querySelector('.line-product').value;
    const quantity = tr.querySelector('.line-qty').value;
    if (product_id && quantity) {
      items.push({ product_id: Number(product_id), quantity: Number(quantity) });
    }
  });
  try {
    const result = await api.post('/api/dispatches', {
      customer_id,
      vehicle_no,
      notes,
      items,
    });
    showMessage(
      'dispatch-message',
      `Dispatch ${result.dispatch_no} saved. Stock updated.`,
      'success'
    );
    document.getElementById('dispatch-vehicle').value = '';
    document.getElementById('dispatch-notes').value = '';
    document.getElementById('lines-body').innerHTML = '';
    document.getElementById('lines-body').appendChild(createLineRow());
    await loadMasters();
    await refreshNextDispatchNo();
  } catch (err) {
    showMessage('dispatch-message', err.message, 'error');
  }
});

document.getElementById('customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage('customer-message');
  try {
    await api.post('/api/customers', {
      name: document.getElementById('customer-name').value.trim(),
      phone: document.getElementById('customer-phone').value.trim(),
      address: document.getElementById('customer-address').value.trim(),
    });
    e.target.reset();
    showMessage('customer-message', 'Customer added.', 'success');
    await loadMasters();
    loadCustomersTable();
  } catch (err) {
    showMessage('customer-message', err.message, 'error');
  }
});

async function loadCustomersTable() {
  const rows = await api.get('/api/customers');
  const tbody = document.querySelector('#customers-table tbody');
  tbody.innerHTML = rows
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phone || '')}</td><td>${escapeHtml(c.address || '')}</td></tr>`
    )
    .join('');
}

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage('product-message');
  try {
    await api.post('/api/products', {
      name: document.getElementById('product-name').value.trim(),
      sku: document.getElementById('product-sku').value.trim(),
      unit: document.getElementById('product-unit').value.trim() || 'pcs',
      stock_qty: document.getElementById('product-stock').value,
    });
    e.target.reset();
    document.getElementById('product-unit').value = 'pcs';
    showMessage('product-message', 'Product added.', 'success');
    await loadMasters();
    loadProductsTable();
  } catch (err) {
    showMessage('product-message', err.message, 'error');
  }
});

async function loadProductsTable() {
  const rows = await api.get('/api/products');
  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = rows
    .map(
      (p) => `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.sku || '')}</td>
      <td>${escapeHtml(p.unit)}</td>
      <td><strong>${p.stock_qty}</strong></td>
      <td>
        <div class="stock-adjust">
          <input type="number" min="0" step="any" class="adj-stock" value="${p.stock_qty}" />
          <button type="button" class="btn secondary save-stock">Save</button>
        </div>
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.save-stock').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const input = tr.querySelector('.adj-stock');
      try {
        await api.patch(`/api/products/${id}/stock`, {
          stock_qty: input.value,
        });
        hideMessage('product-message');
        showMessage('product-message', 'Stock updated.', 'success');
        await loadMasters();
        loadProductsTable();
      } catch (err) {
        showMessage('product-message', err.message, 'error');
      }
    });
  });
}

async function loadHistory() {
  const rows = await api.get('/api/dispatches');
  const tbody = document.querySelector('#history-table tbody');
  const detail = document.getElementById('history-detail');
  detail.hidden = true;
  tbody.innerHTML = rows
    .map(
      (d) => `
    <tr>
      <td>${escapeHtml(d.dispatch_no)}</td>
      <td>${escapeHtml(d.customer_name)}</td>
      <td>${escapeHtml(d.vehicle_no || '—')}</td>
      <td>${escapeHtml(formatDate(d.dispatched_at))}</td>
      <td><button type="button" class="btn link view-dispatch" data-id="${d.id}">View</button></td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.view-dispatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const data = await api.get(`/api/dispatches/${btn.dataset.id}`);
      detail.hidden = false;
      detail.innerHTML = `
        <h3>${escapeHtml(data.dispatch_no)} — ${escapeHtml(data.customer_name)}</h3>
        <p><strong>Vehicle:</strong> ${escapeHtml(data.vehicle_no || '—')}</p>
        <p><strong>Date:</strong> ${escapeHtml(formatDate(data.dispatched_at))}</p>
        <table class="data-table">
          <thead><tr><th>Product</th><th>Qty</th></tr></thead>
          <tbody>
            ${data.items
              .map(
                (i) =>
                  `<tr><td>${escapeHtml(i.product_name)}</td><td>${i.quantity} ${escapeHtml(i.unit)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    });
  });
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

async function init() {
  await loadMasters();
  await refreshNextDispatchNo();
  document.getElementById('lines-body').appendChild(createLineRow());
}

init();
