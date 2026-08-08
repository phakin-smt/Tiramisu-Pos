let products = [];
let stockItems = [];
let editingProductId = null;
let discountManual = false;
const cart = [];
let selectedCategory = 'ทั้งหมด';

const BUNDLE_UNIT_PRICE = 69;
const BUNDLE_QTY = 3;
const BUNDLE_PRICE = 200;
const BUNDLE_DISCOUNT_PER_SET = BUNDLE_UNIT_PRICE * BUNDLE_QTY - BUNDLE_PRICE;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB'
  }).format(amount);
};

const getProductById = (id) => products.find((p) => p.id === id);

async function fetchProducts() {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) {
      throw new Error('Unable to fetch products');
    }

    products = await response.json();
    renderProductGrid();
    renderCategoryTabs();
    renderCategoriesFilter();
    renderStockCount();
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลด master menu ได้');
  }
}

async function fetchCategories() {
  try {
    const response = await fetch('/api/products/categories');
    if (!response.ok) {
      throw new Error('Unable to fetch categories');
    }

    const data = await response.json();
    const filter = document.getElementById('categoryFilter');
    filter.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>';

    (data.categories || []).forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      filter.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

function renderCategoriesFilter() {
  const filter = document.getElementById('categoryFilter');
  const existing = [...new Set(products.map((item) => item.category))];

  filter.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>';

  existing.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    filter.appendChild(option);
  });
}

function renderCategoryTabs() {
  const categories = ['ทั้งหมด', ...new Set(products.map((item) => item.category))];
  const tabContainer = document.getElementById('categoryTabs');
  tabContainer.innerHTML = '';

  categories.forEach((category) => {
    const button = document.createElement('button');
    button.className = 'tab-button' + (selectedCategory === category ? ' active' : '');
    button.textContent = category;
    button.addEventListener('click', () => {
      selectedCategory = category;
      const filter = document.getElementById('categoryFilter');
      filter.value = category;
      renderProductGrid();
      renderCategoryTabs();
    });

    tabContainer.appendChild(button);
  });
}

function renderProductGrid() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const categoryFilter = selectedCategory;

  const filtered = products.filter((p) => {
    const matchesCategory = categoryFilter === 'ทั้งหมด' || p.category === categoryFilter;
    const matchesText = p.name.toLowerCase().includes(search) || p.code.toLowerCase().includes(search);
    return matchesCategory && matchesText;
  });

  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';

  filtered.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.dataset.category = product.category;

    card.innerHTML = `
      <div class="top">
        <span class="tag">${product.category}</span>
        <span>#${product.code}</span>
      </div>
      <div class="image">${product.icon || '📦'}</div>
      <h3>${product.name}</h3>
      <div class="product-meta">รหัส ${product.code}</div>
      <div class="product-price">${formatCurrency(product.price)}</div>
      <div class="product-stock">คงเหลือ ${product.stock} ชิ้น</div>
      <button class="add-button">เพิ่มลงตะกร้า</button>
    `;

    const addButton = card.querySelector('.add-button');
    addButton.addEventListener('click', () => addToCart(product.id));

    grid.appendChild(card);
  });

  document.getElementById('catalogSummary').textContent = `${products.length} รายการ`;
}

function addToCart(productId) {
  const existing = cart.find((item) => item.productId === productId);

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ productId, qty: 1 });
  }

  renderCart();
  showToast('เพิ่มสินค้าเข้าตะกร้า');
}

function removeFromCart(productId) {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index >= 0) {
    cart.splice(index, 1);
    renderCart();
  }
}

function updateCartQty(productId, delta) {
  const item = cart.find((cartItem) => cartItem.productId === productId);
  if (!item) return;

  item.qty += delta;

  if (item.qty <= 0) {
    removeFromCart(productId);
  } else {
    renderCart();
  }
}

function renderCart() {
  const cartItems = document.getElementById('cartItems');

  if (cart.length === 0) {
    cartItems.innerHTML = `<div class="empty-cart">ยังไม่มีสินค้าในตะกร้า</div>`;
  } else {
    cartItems.innerHTML = '';

    cart.forEach((item) => {
      const product = getProductById(item.productId);
      if (!product) return;

      const cartRow = document.createElement('div');
      cartRow.className = 'cart-item';

      cartRow.innerHTML = `
        <div class="cart-item-left">
          <div class="cart-img">${product.icon || '📦'}</div>
          <div>
            <div class="cart-name">${product.name}</div>
            <div class="cart-detail">${formatCurrency(product.price)} x ${item.qty}</div>
            <div class="qty-box">
              <button class="qty-decrease">−</button>
              <span>${item.qty}</span>
              <button class="qty-increase">+</button>
            </div>
          </div>
        </div>
        <div class="item-total">${formatCurrency(product.price * item.qty)}</div>
      `;

      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.style.border = 'none';
      remove.style.background = 'transparent';
      remove.style.color = '#a64a38';
      remove.style.fontSize = '20px';
      remove.style.cursor = 'pointer';
      remove.addEventListener('click', () => removeFromCart(product.id));

      cartRow.appendChild(remove);

      cartRow.querySelector('.qty-decrease').addEventListener('click', () => updateCartQty(product.id, -1));
      cartRow.querySelector('.qty-increase').addEventListener('click', () => updateCartQty(product.id, 1));

      cartItems.appendChild(cartRow);
    });
  }

  renderTotals();
}

function computeTotals() {
  const subtotal = cart.reduce((sum, item) => {
    const product = getProductById(item.productId);
    return product ? sum + product.price * item.qty : sum;
  }, 0);

  const eligibleQty = cart.reduce((sum, item) => {
    const product = getProductById(item.productId);
    return product && product.price === BUNDLE_UNIT_PRICE ? sum + item.qty : sum;
  }, 0);
  const bundleSets = Math.floor(eligibleQty / BUNDLE_QTY);
  const autoDiscount = bundleSets * BUNDLE_DISCOUNT_PER_SET;

  const discountInput = document.getElementById('discountInput');
  if (!discountManual) {
    discountInput.value = autoDiscount;
  }

  const rawDiscount = Number(discountInput.value) || 0;
  const discount = Math.min(Math.max(rawDiscount, 0), subtotal);
  const vat = 0; // VAT ยังไม่เปิดใช้งาน
  const grandTotal = subtotal - discount + vat;

  return { subtotal, bundleSets, autoDiscount, discount, vat, grandTotal };
}

function renderTotals() {
  const totals = computeTotals();

  document.getElementById('subtotalValue').textContent = formatCurrency(totals.subtotal);
  document.getElementById('vatValue').textContent = formatCurrency(totals.vat);
  document.getElementById('grandTotalValue').textContent = formatCurrency(totals.grandTotal);

  document.getElementById('promoHint').hidden = !(totals.bundleSets > 0 && !discountManual);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function initCategories() {
  const categoryFilter = document.getElementById('categoryFilter');
  categoryFilter.addEventListener('change', (event) => {
    selectedCategory = event.target.value || 'ทั้งหมด';
    renderCategoryTabs();
    renderProductGrid();
  });
}

function checkout() {
  if (cart.length === 0) {
    showToast('ไม่มีสินค้าในตะกร้า');
    return;
  }

  const paymentMethod = document.getElementById('paymentMethod').value;

  if (paymentMethod === 'transfer') {
    openQrModal();
  } else {
    submitOrder();
  }
}

function openQrModal() {
  const totals = computeTotals();
  document.getElementById('qrAmountDue').textContent = formatCurrency(totals.grandTotal);
  document.getElementById('qrModal').hidden = false;
}

function closeQrModal() {
  document.getElementById('qrModal').hidden = true;
}

function resetDiscount() {
  discountManual = false;
  document.getElementById('discountInput').value = 0;
}

async function submitOrder() {
  const paymentMethod = document.getElementById('paymentMethod').value;
  const customerType = document.getElementById('customerSelect').value;
  const checkoutBtn = document.getElementById('checkoutBtn');
  const totals = computeTotals();

  checkoutBtn.disabled = true;

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((item) => ({ productId: item.productId, qty: item.qty })),
        paymentMethod,
        customerType,
        discount: totals.discount
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'บันทึกออเดอร์ไม่สำเร็จ');
    }

    showToast(`บันทึกออเดอร์ #${data.orderNumber} - ${formatCurrency(data.total)}`);

    closeQrModal();
    cart.splice(0, cart.length);
    resetDiscount();
    renderCart();

    await Promise.all([fetchProducts(), fetchDailySummary()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'บันทึกออเดอร์ไม่สำเร็จ');
  } finally {
    checkoutBtn.disabled = false;
  }
}

function renderStockCount() {
  const stockCount = products.length;
  document.getElementById('stockCount').textContent = stockCount;
}

async function fetchDailySummary() {
  try {
    const response = await fetch('/api/reports/daily-summary');
    if (!response.ok) {
      throw new Error('Unable to fetch daily summary');
    }

    const summary = await response.json();

    document.getElementById('todaySales').textContent = formatCurrency(summary.totalRevenue);
    document.getElementById('cashTotal').textContent = formatCurrency(summary.cashTotal);
    document.getElementById('transferTotal').textContent = formatCurrency(summary.transferTotal);
    document.getElementById('ordersCount').textContent = summary.orderCount;
  } catch (error) {
    console.error(error);
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach((page) => {
    page.hidden = page.id !== pageId;
  });

  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === pageId);
  });

  if (pageId === 'stockPage') {
    fetchStockSummary();
  }
}

const STOCK_ACTION_LABELS = {
  prepare: 'เตรียมเพิ่ม',
  giveaway: 'บันทึกแถม',
  waste: 'บันทึกของเสีย'
};

async function fetchStockSummary() {
  try {
    const response = await fetch('/api/stock/daily-summary');
    if (!response.ok) {
      throw new Error('Unable to fetch stock summary');
    }

    const summary = await response.json();
    stockItems = summary.items || [];
    renderStockTable(stockItems);
    populateCategoryOptions(stockItems);
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลดข้อมูลสต็อกได้');
  }
}

function populateCategoryOptions(items) {
  const datalist = document.getElementById('categoryOptions');
  const categories = [...new Set(items.map((item) => item.category))];
  datalist.innerHTML = categories.map((c) => `<option value="${c}"></option>`).join('');
}

function renderStockTable(items) {
  const totals = items.reduce(
    (acc, item) => {
      acc.prepared += item.prepared;
      acc.sold += item.sold;
      acc.giveaway += item.giveaway;
      acc.waste += item.waste;
      return acc;
    },
    { prepared: 0, sold: 0, giveaway: 0, waste: 0 }
  );

  document.getElementById('preparedTotal').textContent = totals.prepared;
  document.getElementById('soldTotal').textContent = totals.sold;
  document.getElementById('giveawayTotal').textContent = totals.giveaway;
  document.getElementById('wasteTotal').textContent = totals.waste;

  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = '';

  items.forEach((item) => {
    const row = document.createElement('tr');
    const sellThroughText = item.sellThrough === null ? '—' : `${Math.round(item.sellThrough * 100)}%`;

    row.innerHTML = `
      <td>
        <div class="stock-menu-cell">
          <div class="stock-menu-icon">${item.icon || '🧁'}</div>
          <div>
            <div class="stock-menu-name">${item.name}</div>
            <div class="stock-menu-meta">${item.code}${item.active ? '' : ' · พักขาย'}</div>
          </div>
        </div>
      </td>
      <td class="stock-figure">${item.stockNow}</td>
      <td class="stock-figure">${item.prepared}</td>
      <td class="stock-figure">${item.sold}</td>
      <td class="stock-figure giveaway">${item.giveaway}</td>
      <td class="stock-figure waste">${item.waste}</td>
      <td>${sellThroughText}</td>
      <td>
        <div class="stock-actions">
          <input type="number" class="stock-qty-input" min="1" value="1" />
          <button class="stock-action-btn prepare" data-reason="prepare">+ เตรียม</button>
          <button class="stock-action-btn giveaway" data-reason="giveaway">แถม</button>
          <button class="stock-action-btn waste" data-reason="waste">เสีย</button>
        </div>
      </td>
      <td>
        <div class="stock-manage-actions">
          <button class="stock-manage-btn edit">แก้ไข</button>
          <button class="stock-manage-btn delete">ลบ</button>
        </div>
      </td>
    `;

    const qtyInput = row.querySelector('.stock-qty-input');
    row.querySelectorAll('.stock-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qty = Number(qtyInput.value);
        if (!qty || qty <= 0) {
          showToast('กรอกจำนวนให้ถูกต้อง');
          return;
        }
        submitStockAdjustment(item.productId, btn.dataset.reason, qty);
      });
    });

    row.querySelector('.stock-manage-btn.edit').addEventListener('click', () => openProductModal(item));
    row.querySelector('.stock-manage-btn.delete').addEventListener('click', () => deleteProduct(item));

    tbody.appendChild(row);
  });
}

function openProductModal(item) {
  editingProductId = item ? item.productId : null;

  document.getElementById('productModalTitle').textContent = item ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่';
  document.getElementById('productCode').value = item ? item.code : '';
  document.getElementById('productName').value = item ? item.name : '';
  document.getElementById('productCategory').value = item ? item.category : '';
  document.getElementById('productPrice').value = item ? item.price : '';
  document.getElementById('productCost').value = item ? item.cost : '';
  document.getElementById('productStock').value = item ? item.stockNow : 0;
  document.getElementById('productMinStock').value = item ? item.minStock : 2;
  document.getElementById('productActive').checked = item ? item.active : true;

  document.getElementById('productModal').hidden = false;
}

function closeProductModal() {
  document.getElementById('productModal').hidden = true;
  editingProductId = null;
}

async function saveProduct() {
  const payload = {
    code: document.getElementById('productCode').value.trim(),
    name: document.getElementById('productName').value.trim(),
    category: document.getElementById('productCategory').value.trim(),
    price: Number(document.getElementById('productPrice').value),
    cost: Number(document.getElementById('productCost').value) || 0,
    stock: Number(document.getElementById('productStock').value) || 0,
    minStock: Number(document.getElementById('productMinStock').value) || 0,
    active: document.getElementById('productActive').checked
  };

  if (!payload.code || !payload.name || !payload.category || Number.isNaN(payload.price)) {
    showToast('กรอกรหัสเมนู ชื่อเมนู หมวดหมู่ และราคาให้ครบ');
    return;
  }

  const isEditing = editingProductId !== null;
  const url = isEditing ? `/api/products/${editingProductId}` : '/api/products';
  const method = isEditing ? 'PUT' : 'POST';

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'บันทึกเมนูไม่สำเร็จ');
    }

    showToast(isEditing ? 'แก้ไขเมนูแล้ว' : 'เพิ่มเมนูใหม่แล้ว');
    closeProductModal();
    await Promise.all([fetchStockSummary(), fetchProducts(), fetchCategories()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'บันทึกเมนูไม่สำเร็จ');
  }
}

async function deleteProduct(item) {
  if (!confirm(`ต้องการลบเมนู "${item.name}" ใช่หรือไม่?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/products/${item.productId}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'ลบเมนูไม่สำเร็จ');
    }

    showToast(data.message || 'ลบเมนูแล้ว');
    await Promise.all([fetchStockSummary(), fetchProducts(), fetchCategories()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'ลบเมนูไม่สำเร็จ');
  }
}

async function submitStockAdjustment(productId, reason, quantity) {
  try {
    const response = await fetch('/api/stock/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, reason, quantity })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'บันทึกไม่สำเร็จ');
    }

    showToast(`${STOCK_ACTION_LABELS[reason] || 'บันทึกแล้ว'} ${quantity} ชิ้น`);

    await Promise.all([fetchStockSummary(), fetchProducts()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'บันทึกไม่สำเร็จ');
  }
}

async function init() {
  initCategories();
  renderCart();

  document.getElementById('clearCart').addEventListener('click', () => {
    cart.splice(0, cart.length);
    resetDiscount();
    renderCart();
    showToast('ล้างตะกร้าแล้ว');
  });

  document.getElementById('checkoutBtn').addEventListener('click', checkout);

  document.getElementById('discountInput').addEventListener('input', () => {
    discountManual = true;
    renderTotals();
  });

  document.getElementById('qrModalClose').addEventListener('click', closeQrModal);
  document.getElementById('qrModalCancel').addEventListener('click', closeQrModal);
  document.getElementById('qrModalConfirm').addEventListener('click', submitOrder);
  document.getElementById('qrModal').addEventListener('click', (event) => {
    if (event.target.id === 'qrModal') closeQrModal();
  });

  document.getElementById('holdOrder').addEventListener('click', () => {
    showToast('พักออเดอร์แล้ว');
  });

  document.getElementById('searchInput').addEventListener('input', renderProductGrid);

  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showPage(link.dataset.page);
    });
  });

  document.getElementById('goToStockBtn').addEventListener('click', () => showPage('stockPage'));
  document.getElementById('backToSellBtn').addEventListener('click', () => showPage('sellPage'));

  document.getElementById('addMenuBtn').addEventListener('click', () => openProductModal(null));
  document.getElementById('productModalSave').addEventListener('click', saveProduct);
  document.getElementById('productModalCancel').addEventListener('click', closeProductModal);
  document.getElementById('productModalClose').addEventListener('click', closeProductModal);
  document.getElementById('productModal').addEventListener('click', (event) => {
    if (event.target.id === 'productModal') closeProductModal();
  });

  await fetchCategories();
  await fetchProducts();
  await fetchDailySummary();

  const today = new Date();
  const dateText = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  document.getElementById('dateText').textContent = dateText;
}

init();
