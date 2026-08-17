let products = [];
let stockItems = [];
let settingsMenuItems = [];
let editingProductId = null;
let discountManual = false;
const cart = [];
let orderSubmitting = false;
let pendingOrderKey = null;
let selectedCategory = 'ทั้งหมด';


const BUNDLE_UNIT_PRICE = 69;
const BUNDLE_QTY = 3;
const BUNDLE_PRICE = 200;
const BUNDLE_DISCOUNT_PER_SET = BUNDLE_UNIT_PRICE * BUNDLE_QTY - BUNDLE_PRICE;
const APP_TIME_ZONE = 'Asia/Bangkok';
const PAGE_ORDER = ['sellPage', 'stockPage', 'ordersPage', 'reportPage', 'settingsPage'];


function bangkokDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}


function bangkokDateISO() {
  const { year, month, day } = bangkokDateParts();
  return `${year}-${month}-${day}`;
}

function formatThaiDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}


const formatCurrency = (amount) => {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB'
  }).format(amount);
};


const getProductById = (id) => products.find((p) => p.id === id);
const cartQtyFor = (id) => {
  const item = cart.find((cartItem) => cartItem.productId === id);
  return item ? item.qty : 0;
};

function setCartOpen(open) {
  document.body.classList.toggle('cart-open', open);
  document.getElementById('mobileCartBar').setAttribute('aria-expanded', String(open));
}

function showLogin(message = '') {
  document.getElementById('appShell').hidden = true;
  document.getElementById('loginOverlay').hidden = false;
  document.getElementById('loginError').textContent = message;
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').focus();
}

function showApplication() {
  document.getElementById('loginOverlay').hidden = true;
  document.getElementById('appShell').hidden = false;
}

async function apiFetch(url, options) {
  const response = await window.fetch(url, options);
  if (response.status === 401) {
    showLogin('Session expired. Please log in again.');
    throw new Error('Authentication required');
  }
  return response;
}

async function checkAuthentication() {
  try {
    const response = await window.fetch('/api/auth/status');
    if (!response.ok) throw new Error('Unable to check login status');
    const status = await response.json();
    if (!status.configured) {
      showLogin('PIN authentication is not configured.');
      return false;
    }
    if (!status.authenticated) {
      showLogin();
      return false;
    }
    showApplication();
    return true;
  } catch (error) {
    showLogin('Unable to connect to the server.');
    return false;
  }
}

async function login(event) {
  event.preventDefault();
  const button = document.getElementById('loginButton');
  const pin = document.getElementById('pinInput').value;
  button.disabled = true;
  document.getElementById('loginError').textContent = '';
  try {
    const response = await window.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    window.location.reload();
  } catch (error) {
    document.getElementById('loginError').textContent = error.message || 'Login failed';
    document.getElementById('pinInput').select();
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    showLogin('You have been logged out.');
  }
}


async function fetchProducts() {
  try {
    const response = await apiFetch('/api/products');
    if (!response.ok) {
      throw new Error('Unable to fetch products');
    }


    products = await response.json();
    renderProductGrid();
    renderCategoryTabs();
    renderStockCount();
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลด master menu ได้');
  }
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
      renderProductGrid();
      renderCategoryTabs();
    });


    tabContainer.appendChild(button);
  });
}


function renderProductGrid() {
  const categoryFilter = selectedCategory;


  const filtered = products.filter((p) => {
    const matchesCategory = categoryFilter === 'ทั้งหมด' || p.category === categoryFilter;
    return matchesCategory;
  });


  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';


  filtered.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.dataset.category = product.category;
    card.dataset.productId = product.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `เพิ่ม ${product.name} ลงตะกร้า`);


    card.innerHTML = `
      <div class="image">${product.icon || '📦'}</div>
      <h3>${product.name}</h3>
      <div class="product-price">${formatCurrency(product.price)}</div>
      <div class="product-stock">คงเหลือ ${product.stock} ชิ้น</div>
    `;


    card.addEventListener('click', () => {
      if (!card.classList.contains('is-unavailable')) addToCart(product.id);
    });
    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !card.classList.contains('is-unavailable')) {
        event.preventDefault();
        addToCart(product.id);
      }
    });


    grid.appendChild(card);
  });


  document.getElementById('catalogSummary').textContent = `${products.length} รายการ`;
  syncProductCardAvailability();
}


function syncProductCardAvailability() {
  document.querySelectorAll('.product-card').forEach((card) => {
    const product = getProductById(Number(card.dataset.productId));
    if (!product) return;

    const remaining = product.stock - cartQtyFor(product.id);
    const unavailable = remaining <= 0;
    card.classList.toggle('is-unavailable', unavailable);
    card.setAttribute('aria-disabled', String(unavailable));
    card.querySelector('.product-stock').textContent = `คงเหลือ ${Math.max(remaining, 0)} ชิ้น`;
  });
}


function addToCart(productId) {
  const product = getProductById(productId);
  if (!product || cartQtyFor(productId) + 1 > product.stock) {
    showToast('สินค้าคงเหลือไม่พอ');
    return;
  }

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

  if (delta > 0) {
    const product = getProductById(productId);
    if (product && item.qty + delta > product.stock) {
      showToast('สินค้าคงเหลือไม่พอ');
      return;
    }
  }


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
      remove.className = 'cart-remove-btn';
      remove.addEventListener('click', () => removeFromCart(product.id));


      cartRow.appendChild(remove);


      cartRow.querySelector('.qty-decrease').addEventListener('click', () => updateCartQty(product.id, -1));
      const increaseBtn = cartRow.querySelector('.qty-increase');
      increaseBtn.disabled = item.qty >= product.stock;
      increaseBtn.addEventListener('click', () => updateCartQty(product.id, 1));


      cartItems.appendChild(cartRow);
    });
  }


  syncProductCardAvailability();
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
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);


  document.getElementById('subtotalValue').textContent = formatCurrency(totals.subtotal);
  document.getElementById('vatValue').textContent = formatCurrency(totals.vat);
  document.getElementById('grandTotalValue').textContent = formatCurrency(totals.grandTotal);
  document.getElementById('mobileCartCount').textContent = `${itemCount} ชิ้น`;
  document.getElementById('mobileCartTotal').textContent = formatCurrency(totals.grandTotal);


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
  setCartOpen(false);
  document.getElementById('qrAmountDue').textContent = formatCurrency(totals.grandTotal);
  const qr = document.getElementById('promptPayQr');
  const status = document.getElementById('qrStatus');
  const confirm = document.getElementById('qrModalConfirm');
  qr.hidden = true;
  confirm.disabled = true;
  status.textContent = 'กำลังสร้าง QR ตามยอด...';
  status.classList.remove('is-error');
  qr.onload = () => {
    qr.hidden = false;
    confirm.disabled = false;
    status.textContent = 'QR นี้ใส่ยอดให้แล้ว กรุณาตรวจชื่อผู้รับก่อนโอน';
  };
  qr.onerror = () => {
    qr.hidden = true;
    confirm.disabled = true;
    status.textContent = 'สร้าง QR ไม่สำเร็จ กรุณาตรวจการตั้งค่าพร้อมเพย์';
    status.classList.add('is-error');
  };
  qr.src = `/api/payment-qr?amount=${encodeURIComponent(totals.grandTotal.toFixed(2))}&t=${Date.now()}`;
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
 if (orderSubmitting) return;
  const paymentMethod = document.getElementById('paymentMethod').value;
  const customerType = document.getElementById('customerSelect').value;
  const paymentButtons = document.querySelectorAll('.payment-option');
 const qrConfirmBtn = document.getElementById('qrModalConfirm');
  const totals = computeTotals();


 orderSubmitting = true;
  paymentButtons.forEach((button) => { button.disabled = true; });
 qrConfirmBtn.disabled = true;
 pendingOrderKey = pendingOrderKey || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);


  try {
    const response = await apiFetch('/api/orders', {
      method: 'POST',
     headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pendingOrderKey },
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
    setCartOpen(false);
    cart.splice(0, cart.length);
   pendingOrderKey = null;
    resetDiscount();
    renderCart();


    await Promise.all([fetchProducts(), fetchDailySummary()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'บันทึกออเดอร์ไม่สำเร็จ');
  } finally {
   orderSubmitting = false;
    paymentButtons.forEach((button) => { button.disabled = false; });
   qrConfirmBtn.disabled = false;
  }
}


function renderStockCount() {
  const stockCount = products.length;
  document.getElementById('stockCount').textContent = stockCount;
}


async function fetchDailySummary() {
  try {
    const response = await apiFetch('/api/reports/daily-summary');
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
  setCartOpen(false);
  document.getElementById('mobileCartBar').hidden = pageId !== 'sellPage';
  document.querySelectorAll('.page').forEach((page) => {
    page.hidden = page.id !== pageId;
  });


  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === pageId);
  });


  if (pageId === 'stockPage') {
    fetchStockSummary();
  }

  if (pageId === 'settingsPage') {
    fetchMenuSettings();
  }

  if (pageId === 'ordersPage') {
    fetchOrders(document.getElementById('ordersDateInput').value);
  }
}


const STOCK_ACTION_LABELS = {
  prepare: 'เตรียมเพิ่ม',
  undo_prepare: 'ยกเลิกเตรียม',
  giveaway: 'บันทึกแถม',
  undo_giveaway: 'ยกเลิกแถม',
  waste: 'บันทึกของเสีย',
  undo_waste: 'ยกเลิกของเสีย',
  correction: 'ปรับสต็อก'
};


async function fetchStockSummary(date = document.getElementById('stockDateInput')?.value || bangkokDateISO()) {
  try {
    const response = await apiFetch(`/api/stock/daily-summary?date=${encodeURIComponent(date)}`);
    if (!response.ok) {
      throw new Error('Unable to fetch stock summary');
    }


    const summary = await response.json();
    stockItems = (summary.items || []).filter((item) => item.active);
    const isToday = summary.date === bangkokDateISO();
    document.getElementById('stockDateHint').textContent = isToday
      ? 'เพิ่มหรือลดยอดเตรียม แถม และเสียของวันนี้'
      : `ประวัติประจำวันที่ ${formatThaiDate(summary.date)} · ดูย้อนหลังอย่างเดียว`;
    renderStockTable(stockItems, isToday);
    populateCategoryOptions(stockItems);
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลดข้อมูลสต็อกได้');
  }
}

function enablePageSwipe() {
  const mainContent = document.querySelector('.main-content');
  let touchStartX = 0;
  let touchStartY = 0;

  mainContent.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.target.closest('input, select, textarea, button, .modal-overlay')) {
      touchStartX = 0;
      touchStartY = 0;
      return;
    }
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });

  mainContent.addEventListener('touchend', (event) => {
    if (!touchStartX || event.changedTouches.length !== 1 || !window.matchMedia('(max-width: 1199px)').matches) return;

    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    touchStartX = 0;
    touchStartY = 0;

    if (Math.abs(deltaX) < 80 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

    const currentPage = document.querySelector('.page:not([hidden])');
    const currentIndex = PAGE_ORDER.indexOf(currentPage?.id);
    if (currentIndex < 0) return;

    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < PAGE_ORDER.length) showPage(PAGE_ORDER[nextIndex]);
  }, { passive: true });
}

async function fetchMenuSettings() {
  try {
    const response = await apiFetch(`/api/stock/daily-summary?date=${bangkokDateISO()}`);
    if (!response.ok) throw new Error('Unable to fetch menu settings');
    const summary = await response.json();
    settingsMenuItems = summary.items || [];
    populateSettingsCategoryFilter(settingsMenuItems);
    applyMenuSettingsFilters();
    populateCategoryOptions(settingsMenuItems);
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลดรายการเมนูได้');
  }
}

function populateSettingsCategoryFilter(items) {
  const select = document.getElementById('settingsCategoryFilter');
  const previousValue = select.value;
  const categories = [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'th'));
  select.innerHTML = '<option value="all">ทุกหมวดหมู่</option>'
    + categories.map((category) => `<option value="${category}">${category}</option>`).join('');
  select.value = categories.includes(previousValue) ? previousValue : 'all';
}

function applyMenuSettingsFilters() {
  const query = document.getElementById('settingsMenuSearch').value.trim().toLocaleLowerCase('th');
  const status = document.getElementById('settingsStatusFilter').value;
  const category = document.getElementById('settingsCategoryFilter').value;
  const filteredItems = settingsMenuItems.filter((item) => {
    const matchesQuery = !query || item.name.toLocaleLowerCase('th').includes(query)
      || item.code.toLocaleLowerCase('th').includes(query);
    const matchesStatus = status === 'all' || (status === 'active' ? item.active : !item.active);
    const matchesCategory = category === 'all' || item.category === category;
    return matchesQuery && matchesStatus && matchesCategory;
  });
  renderMenuSettings(filteredItems, settingsMenuItems.length);
}

function renderMenuSettings(items, totalCount = items.length) {
  const list = document.getElementById('settingsMenuList');
  const openCount = settingsMenuItems.filter((item) => item.active).length;
  document.getElementById('settingsMenuSubtitle').textContent = items.length === totalCount
    ? `${totalCount} เมนู · เปิดขาย ${openCount} เมนู`
    : `พบ ${items.length} จาก ${totalCount} เมนู · เปิดขายทั้งหมด ${openCount} เมนู`;
  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = '<div class="settings-menu-empty">ไม่พบเมนูที่ตรงกับตัวกรอง</div>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = `settings-menu-item${item.active ? '' : ' is-inactive'}`;
    card.innerHTML = `
      <div class="stock-menu-icon">${item.icon || '🧁'}</div>
      <div class="settings-menu-info">
        <strong>${item.name}</strong>
        <span>${item.code} · ${item.category} · ${formatCurrency(item.price)}</span>
      </div>
      <label class="menu-active-switch">
        <input type="checkbox" ${item.active ? 'checked' : ''} aria-label="เปิดขาย ${item.name}">
        <span>${item.active ? 'เปิดขาย' : 'พักขาย'}</span>
      </label>
      <div class="settings-menu-actions">
        <button class="btn btn-light edit-menu-btn" type="button">แก้ไข</button>
        <button class="btn btn-danger delete-menu-btn" type="button">ลบ</button>
      </div>
    `;

    const activeInput = card.querySelector('.menu-active-switch input');
    activeInput.addEventListener('change', () => setMenuActive(item, activeInput.checked));
    card.querySelector('.edit-menu-btn').addEventListener('click', () => openProductModal(item));
    card.querySelector('.delete-menu-btn').addEventListener('click', () => deleteProduct(item));
    list.appendChild(card);
  });
}

async function setMenuActive(item, active) {
  try {
    const response = await apiFetch(`/api/products/${item.productId}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'เปลี่ยนสถานะเมนูไม่สำเร็จ');
    showToast(active ? `เปิดขาย ${item.name} แล้ว` : `พักขาย ${item.name} แล้ว`);
    await Promise.all([fetchMenuSettings(), fetchProducts()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'เปลี่ยนสถานะเมนูไม่สำเร็จ');
    await fetchMenuSettings();
  }
}


function populateCategoryOptions(items) {
  const datalist = document.getElementById('categoryOptions');
  const categories = [...new Set(items.map((item) => item.category))];
  datalist.innerHTML = categories.map((c) => `<option value="${c}"></option>`).join('');
}


function renderStockTable(items, editable = true) {
  const tbody = document.getElementById('stockTableBody');
  tbody.innerHTML = '';


  items.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <div class="stock-menu-cell">
          <div class="stock-menu-icon">${item.icon || '🧁'}</div>
          <div>
            <div class="stock-menu-name">${item.name}</div>
            <div class="stock-menu-meta">${item.code} · คงเหลือ ${item.stockNow} ชิ้น${item.active ? '' : ' · พักขาย'}</div>
          </div>
        </div>
      </td>
      <td>
        <div class="stock-counter-groups" aria-label="ปรับจำนวน ${item.name}">
          <div class="stock-counter-group prepared">
            <span>เตรียม${editable ? 'วันนี้' : ''}</span>
            <div><button type="button" data-reason="undo_prepare" data-quantity="1" ${!editable || item.prepared <= 0 || item.stockNow <= 0 ? 'disabled' : ''}>−</button><input class="stock-counter-input" type="number" min="0" step="1" inputmode="numeric" value="${item.prepared}" data-value="${item.prepared}" data-increase-reason="prepare" data-decrease-reason="undo_prepare" aria-label="จำนวนเตรียม ${item.name}" ${editable ? '' : 'readonly'}><button type="button" data-reason="prepare" data-quantity="1" ${editable ? '' : 'disabled'}>+</button></div>
          </div>
          <div class="stock-counter-group giveaway">
            <span>แถม${editable ? 'วันนี้' : ''}</span>
            <div><button type="button" data-reason="undo_giveaway" data-quantity="1" ${!editable || item.giveaway <= 0 ? 'disabled' : ''}>−</button><input class="stock-counter-input" type="number" min="0" step="1" inputmode="numeric" value="${item.giveaway}" data-value="${item.giveaway}" data-increase-reason="giveaway" data-decrease-reason="undo_giveaway" aria-label="จำนวนแถม ${item.name}" ${editable ? '' : 'readonly'}><button type="button" data-reason="giveaway" data-quantity="1" ${!editable || item.stockNow <= 0 ? 'disabled' : ''}>+</button></div>
          </div>
          <div class="stock-counter-group waste">
            <span>เสีย${editable ? 'วันนี้' : ''}</span>
            <div><button type="button" data-reason="undo_waste" data-quantity="1" ${!editable || item.waste <= 0 ? 'disabled' : ''}>−</button><input class="stock-counter-input" type="number" min="0" step="1" inputmode="numeric" value="${item.waste}" data-value="${item.waste}" data-increase-reason="waste" data-decrease-reason="undo_waste" aria-label="จำนวนเสีย ${item.name}" ${editable ? '' : 'readonly'}><button type="button" data-reason="waste" data-quantity="1" ${!editable || item.stockNow <= 0 ? 'disabled' : ''}>+</button></div>
          </div>
        </div>
      </td>
    `;

    row.querySelectorAll('.stock-counter-group button').forEach((button) => {
      button.addEventListener('click', () => {
        submitStockAdjustment(item.productId, button.dataset.reason, Number(button.dataset.quantity));
      });
    });

    row.querySelectorAll('.stock-counter-input:not([readonly])').forEach((input) => {
      let submitted = false;
      const submitTypedValue = () => {
        if (submitted) return;

        const previousValue = Number(input.dataset.value);
        const nextValue = Number(input.value);
        if (!Number.isInteger(nextValue) || nextValue < 0) {
          input.value = previousValue;
          showToast('กรุณากรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
          return;
        }

        const difference = nextValue - previousValue;
        if (difference === 0) return;

        submitted = true;
        const reason = difference > 0 ? input.dataset.increaseReason : input.dataset.decreaseReason;
        submitStockAdjustment(item.productId, reason, Math.abs(difference));
      };

      input.addEventListener('change', submitTypedValue);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
    });


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
    const response = await apiFetch(url, {
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
    await Promise.all([fetchStockSummary(), fetchProducts(), fetchMenuSettings()]);
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
    const response = await apiFetch(`/api/products/${item.productId}`, { method: 'DELETE' });
    const data = await response.json();


    if (!response.ok) {
      throw new Error(data.error || 'ลบเมนูไม่สำเร็จ');
    }


    showToast(data.message || 'ลบเมนูแล้ว');
    await Promise.all([fetchStockSummary(), fetchProducts(), fetchMenuSettings()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'ลบเมนูไม่สำเร็จ');
  }
}


async function submitStockAdjustment(productId, reason, quantity) {
  try {
    const response = await apiFetch('/api/stock/adjust', {
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


const PAYMENT_LABELS = {
 cash: 'เงินสด',
 transfer: 'โอน/พร้อมเพย์'
};


function formatTimeOnly(datetimeStr) {
 const match = /\d{2}:\d{2}/.exec(datetimeStr || '');
 return match ? match[0] : '-';
}


async function closeDay() {
 const closeDayBtn = document.getElementById('closeDayBtn');
 closeDayBtn.disabled = true;


 try {
   const response = await apiFetch('/api/reports/close-day');
   if (!response.ok) {
     throw new Error('ไม่สามารถสรุปยอดขายได้');
   }


   const report = await response.json();
   renderCloseDayReport(report, 'report');


   document.getElementById('reportEmptyState').hidden = true;
   document.getElementById('reportContent').hidden = false;
   showToast('สรุปยอดขายวันนี้เรียบร้อยแล้ว');
 } catch (error) {
   console.error(error);
   showToast(error.message || 'ไม่สามารถสรุปยอดขายได้');
 } finally {
   closeDayBtn.disabled = false;
 }
}


async function openCloseDayModal() {
 const closeDaySellBtn = document.getElementById('closeDaySellBtn');
 closeDaySellBtn.disabled = true;

 try {
   const response = await apiFetch('/api/reports/close-day');
   if (!response.ok) {
     throw new Error('ไม่สามารถสรุปยอดขายได้');
   }

   const report = await response.json();
   renderCloseDayReport(report, 'modalReport');
   document.getElementById('closeDayModal').hidden = false;
 } catch (error) {
   console.error(error);
   showToast(error.message || 'ไม่สามารถสรุปยอดขายได้');
 } finally {
   closeDaySellBtn.disabled = false;
 }
}


function closeCloseDayModal() {
 document.getElementById('closeDayModal').hidden = true;
}


function renderCloseDayReport(report, prefix) {
 document.getElementById(`${prefix}TotalRevenue`).textContent = formatCurrency(report.totalRevenue);
 document.getElementById(`${prefix}OrderCount`).textContent = `${report.orderCount} ออเดอร์`;
 document.getElementById(`${prefix}CashTotal`).textContent = formatCurrency(report.cashTotal);
 document.getElementById(`${prefix}TransferTotal`).textContent = formatCurrency(report.transferTotal);
 document.getElementById(`${prefix}Subtotal`).textContent = formatCurrency(report.subtotalAll);
 document.getElementById(`${prefix}Discount`).textContent = formatCurrency(report.discountAll);
 document.getElementById(`${prefix}CostTotal`).textContent = formatCurrency(report.costTotal);
 document.getElementById(`${prefix}NetProfit`).textContent = formatCurrency(report.netProfit);
 document.getElementById(`${prefix}OrdersSubtitle`).textContent = `${report.orderCount} ออเดอร์`;


 const ordersBody = document.getElementById(`${prefix}OrdersBody`);
 ordersBody.innerHTML = '';


 if (report.orders.length === 0) {
   ordersBody.innerHTML = `<tr><td colspan="6" class="report-items-cell">ยังไม่มีออเดอร์วันนี้</td></tr>`;
 } else {
   report.orders.forEach((order) => {
     const itemsText = order.items.map((item) => `${item.name} x${item.qty}`).join('<br />');
     const row = document.createElement('tr');
     row.innerHTML = `
       <td>${formatTimeOnly(order.time)}</td>
       <td>#${order.orderNumber}</td>
       <td>${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</td>
       <td class="report-items-cell">${itemsText}</td>
       <td>${formatCurrency(order.discount)}</td>
       <td class="stock-figure">${formatCurrency(order.total)}</td>
     `;
     ordersBody.appendChild(row);
   });
 }


 const menuBody = document.getElementById(`${prefix}MenuBody`);
 menuBody.innerHTML = '';


 report.menuSummary.forEach((item) => {
   const row = document.createElement('tr');
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
     <td class="stock-figure">${item.sold}</td>
     <td class="stock-figure giveaway">${item.giveaway}</td>
     <td class="stock-figure waste">${item.waste}</td>
     <td class="stock-figure">${item.remaining}</td>
   `;
   menuBody.appendChild(row);
 });
}


const ORDER_STATUS_LABELS = {
 completed: 'เสร็จสิ้น',
 cancelled: 'ยกเลิกแล้ว'
};


let ordersList = [];


async function fetchOrders(dateStr) {
  try {
    const response = await apiFetch(`/api/orders?date=${dateStr}`);
    if (!response.ok) {
      throw new Error('Unable to fetch orders');
    }

    const data = await response.json();
    ordersList = data.orders || [];
    renderOrdersTable();
  } catch (error) {
    console.error(error);
    showToast('ไม่สามารถโหลดรายการออเดอร์ได้');
  }
}


function renderOrdersTable() {
  document.getElementById('ordersSubtitle').textContent = `${ordersList.length} ออเดอร์`;

  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = '';

  if (ordersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="report-items-cell">ยังไม่มีออเดอร์ในวันนี้</td></tr>`;
    return;
  }

  ordersList.forEach((order) => {
    const itemsText = order.items.map((item) => `${item.name} x${item.qty}`).join('<br />');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatTimeOnly(order.time)}</td>
      <td>#${order.orderNumber}</td>
      <td>${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</td>
      <td class="report-items-cell">${itemsText}</td>
      <td class="stock-figure">${formatCurrency(order.total)}</td>
      <td><span class="status-badge ${order.status === 'cancelled' ? 'cancelled' : 'completed'}">${ORDER_STATUS_LABELS[order.status] || order.status}</span></td>
      <td></td>
    `;

    const actionCell = row.lastElementChild;
    if (order.status === 'completed') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'stock-manage-btn delete';
      cancelBtn.textContent = 'ยกเลิก';
      cancelBtn.addEventListener('click', () => cancelOrder(order.id));
      actionCell.appendChild(cancelBtn);
    }

    tbody.appendChild(row);
  });
}


async function cancelOrder(orderId) {
  if (!confirm('ต้องการยกเลิกออเดอร์นี้ใช่หรือไม่? สต็อกที่ตัดไปจะถูกคืนอัตโนมัติ')) {
    return;
  }

  try {
    const response = await apiFetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'ยกเลิกออเดอร์ไม่สำเร็จ');
    }

    showToast('ยกเลิกออเดอร์แล้ว');
    await Promise.all([fetchOrders(document.getElementById('ordersDateInput').value), fetchProducts()]);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'ยกเลิกออเดอร์ไม่สำเร็จ');
  }
}


async function init() {
  document.getElementById('loginForm').addEventListener('submit', login);
  document.getElementById('logoutButton').addEventListener('click', logout);
  if (!(await checkAuthentication())) return;

  renderCart();

  document.querySelectorAll('.customer-option').forEach((option) => {
    option.addEventListener('click', () => {
      document.getElementById('customerSelect').value = option.dataset.customerType;
      document.querySelectorAll('.customer-option').forEach((item) => {
        const selected = item === option;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    });
  });

  document.querySelectorAll('.payment-option').forEach((option) => {
    option.addEventListener('click', () => {
      document.getElementById('paymentMethod').value = option.dataset.paymentMethod;
      document.querySelectorAll('.payment-option').forEach((item) => {
        const selected = item === option;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      checkout();
    });
  });

  document.getElementById('toggleSalesMetrics').addEventListener('click', (event) => {
    const metrics = document.getElementById('salesMetrics');
    const collapsed = !metrics.hidden;
    metrics.hidden = collapsed;
    event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    event.currentTarget.textContent = collapsed ? '▾ แสดงสรุป' : '▴ ซ่อนสรุป';
  });


  document.getElementById('clearCart').addEventListener('click', () => {
    cart.splice(0, cart.length);
    resetDiscount();
    renderCart();
    showToast('ล้างตะกร้าแล้ว');
  });


  document.getElementById('mobileCartBar').addEventListener('click', () => setCartOpen(true));
  document.getElementById('closeCartBtn').addEventListener('click', () => setCartOpen(false));
  document.getElementById('cartBackdrop').addEventListener('click', () => setCartOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setCartOpen(false);
  });


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


  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showPage(link.dataset.page);
    });
  });

  enablePageSwipe();


  document.getElementById('goToStockBtn').addEventListener('click', () => showPage('stockPage'));
  document.getElementById('addMenuBtn').addEventListener('click', () => openProductModal(null));
  document.getElementById('settingsMenuSearch').addEventListener('input', applyMenuSettingsFilters);
  document.getElementById('settingsStatusFilter').addEventListener('change', applyMenuSettingsFilters);
  document.getElementById('settingsCategoryFilter').addEventListener('change', applyMenuSettingsFilters);
 document.getElementById('backToSellFromReportBtn').addEventListener('click', () => showPage('sellPage'));
 document.getElementById('closeDayBtn').addEventListener('click', closeDay);


  const todayBangkok = bangkokDateISO();
  document.getElementById('stockDateInput').max = todayBangkok;
  document.getElementById('stockDateInput').value = todayBangkok;
  document.getElementById('stockDateInput').addEventListener('change', (event) => {
    if (event.target.value) fetchStockSummary(event.target.value);
  });
  document.getElementById('ordersDateInput').max = todayBangkok;
  document.getElementById('ordersDateInput').value = todayBangkok;
  document.getElementById('ordersDateInput').addEventListener('change', (event) => {
    fetchOrders(event.target.value);
  });

  document.getElementById('closeDaySellBtn').addEventListener('click', openCloseDayModal);
  document.getElementById('closeDayModalClose').addEventListener('click', closeCloseDayModal);
  document.getElementById('closeDayModal').addEventListener('click', (event) => {
    if (event.target.id === 'closeDayModal') closeCloseDayModal();
  });

  document.getElementById('productModalSave').addEventListener('click', saveProduct);
  document.getElementById('productModalCancel').addEventListener('click', closeProductModal);
  document.getElementById('productModalClose').addEventListener('click', closeProductModal);
  document.getElementById('productModal').addEventListener('click', (event) => {
    if (event.target.id === 'productModal') closeProductModal();
  });


  await fetchProducts();
  await fetchDailySummary();


  const { year, month, day } = bangkokDateParts();
  const dateText = `${day}/${month}/${year}`;
  document.getElementById('dateText').textContent = dateText;
}


init();
