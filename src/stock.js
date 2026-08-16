// 庫存核心：所有進出都必須經過 applyMove，stock_moves 是庫存的唯一真相來源。
// 成本採「移動平均法」——只有入庫（採購進貨、退料回庫）會重算 products.cost，
// 出庫一律以當下平均成本作為成本快照寫入單據，日後改價不會回頭改動歷史毛利。
const { db, getSetting, today } = require('./db');

// 出庫類（qty 應為負）
const OUT_KINDS = ['sale', 'issue', 'purchase_return', 'transfer_out'];
// 入庫類（qty 應為正）
const IN_KINDS = ['purchase', 'sale_return', 'issue_return', 'transfer_in'];

const KIND_TW = {
  purchase: '採購進貨', purchase_return: '採購退貨', sale: '銷貨出庫', sale_return: '銷貨退回',
  issue: '工單領料', issue_return: '工單退料', transfer_in: '調撥入庫', transfer_out: '調撥出庫',
  adjust: '盤點調整'
};

function getStock(productId, warehouseId) {
  const r = db.prepare('SELECT qty FROM stocks WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId);
  return r ? r.qty : 0;
}

// 全倉合計庫存
function totalStock(productId) {
  const r = db.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM stocks WHERE product_id = ?').get(productId);
  return r.q;
}

/**
 * 寫入一筆庫存異動並同步結存與成本。
 * @param {object} m
 *   product_id, warehouse_id, kind, qty（正入負出）, cost（入庫必填單價；出庫留空則取現行平均成本）,
 *   ref_type, ref_id, ref_no, user_id, note, move_date
 * @returns {{cost:number, balance:number, move_id:number}}
 */
function applyMove(m) {
  const productId = Number(m.product_id);
  const warehouseId = Number(m.warehouse_id);
  const qty = Number(m.qty);
  if (!productId || !warehouseId) throw new Error('庫存異動缺少料件或倉別');
  if (!qty || !isFinite(qty)) throw new Error('庫存異動數量不可為 0');
  if (IN_KINDS.includes(m.kind) && qty < 0) throw new Error(`${KIND_TW[m.kind]} 數量應為正數`);
  if (OUT_KINDS.includes(m.kind) && qty > 0) throw new Error(`${KIND_TW[m.kind]} 數量應為負數`);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('料件不存在');

  const before = getStock(productId, warehouseId);
  const after = Number((before + qty).toFixed(4));
  if (after < 0 && getSetting('stock_negative', '0') !== '1') {
    const wh = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(warehouseId);
    throw new Error(`${product.name} 在「${wh ? wh.name : '該倉'}」庫存不足（現有 ${before} ${product.unit}，需 ${Math.abs(qty)}）`);
  }

  // 成本：入庫用進價重算全公司移動平均；出庫沿用現行平均成本
  let unitCost = Math.round(Number(m.cost) || 0);
  if (qty > 0 && m.kind !== 'adjust') {
    const totalBefore = totalStock(productId);
    if (unitCost > 0) {
      const newAvg = totalBefore + qty > 0
        ? Math.round((totalBefore * product.cost + qty * unitCost) / (totalBefore + qty))
        : unitCost;
      db.prepare('UPDATE products SET cost = ?, last_cost = ? WHERE id = ?').run(newAvg, unitCost, productId);
    } else {
      unitCost = product.cost;   // 退料回庫等未帶價的入庫，沿用平均成本
    }
  } else if (!unitCost) {
    unitCost = product.cost;
  }

  db.prepare(`INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?,?,?)
              ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty`)
    .run(productId, warehouseId, after);

  const info = db.prepare(`INSERT INTO stock_moves
      (move_date, product_id, warehouse_id, kind, qty, cost, balance, ref_type, ref_id, ref_no, user_id, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(m.move_date || today(), productId, warehouseId, m.kind, qty, unitCost, after,
      m.ref_type || '', m.ref_id || null, m.ref_no || '', m.user_id || null, m.note || '');

  return { cost: unitCost, balance: after, move_id: info.lastInsertRowid };
}

// 回沖某張單據產生的全部異動（作廢／退回草稿時用）
function revertMoves(refType, refId, userId) {
  const moves = db.prepare('SELECT * FROM stock_moves WHERE ref_type = ? AND ref_id = ? ORDER BY id DESC')
    .all(refType, refId);
  for (const mv of moves) {
    // 反向異動不再動平均成本（cost 直接沿用原筆），避免作廢反覆污染成本
    const before = getStock(mv.product_id, mv.warehouse_id);
    const after = Number((before - mv.qty).toFixed(4));
    db.prepare(`INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?,?,?)
                ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty`)
      .run(mv.product_id, mv.warehouse_id, after);
    db.prepare(`INSERT INTO stock_moves
        (move_date, product_id, warehouse_id, kind, qty, cost, balance, ref_type, ref_id, ref_no, user_id, note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(today(), mv.product_id, mv.warehouse_id, 'adjust', -mv.qty, mv.cost, after,
        refType, refId, mv.ref_no, userId || null, `${KIND_TW[mv.kind] || mv.kind} 回沖`);
  }
  return moves.length;
}

// 依客戶價格等級取售價（無設定則退回零售價）
function priceFor(product, level) {
  if (!product) return 0;
  if (level === 'contract' && product.price_contract) return product.price_contract;
  if (level === 'wholesale' && product.price_wholesale) return product.price_wholesale;
  return product.price_retail;
}

// 低於安全庫存的料件
function lowStockList() {
  return db.prepare(`
    SELECT p.id, p.sku, p.name, p.spec, p.unit, p.safety_qty, p.cost,
           COALESCE((SELECT SUM(qty) FROM stocks s WHERE s.product_id = p.id), 0) AS qty,
           (SELECT name FROM suppliers WHERE id = p.default_supplier_id) AS supplier_name
    FROM products p
    WHERE p.active = 1 AND p.kind != 'service' AND p.safety_qty > 0
      AND COALESCE((SELECT SUM(qty) FROM stocks s WHERE s.product_id = p.id), 0) < p.safety_qty
    ORDER BY (COALESCE((SELECT SUM(qty) FROM stocks s WHERE s.product_id = p.id), 0) - p.safety_qty) ASC`).all();
}

module.exports = { applyMove, revertMoves, getStock, totalStock, priceFor, lowStockList, KIND_TW, IN_KINDS, OUT_KINDS };
