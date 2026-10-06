# Riyansh Blow Moulding — Dispatch

Manual dispatch entry with **Customer Master**, **Product Master**, and automatic **stock deduction** on submit.

## Setup

```bash
npm install
npm run seed   # optional sample customers & products
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Flow

1. Add customers and products (with opening stock) under the master tabs.
2. **Dispatch (Manual)** — pick customer from master, add product lines from master, enter quantities.
3. On **Submit dispatch**, stock is reduced in a single database transaction. If any line has insufficient stock, the whole dispatch is rejected.

Data is stored in `data/riyansh.db` (SQLite).
