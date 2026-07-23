// 妫€鏌ョ櫥褰曠姸鎬佸苟鍒囨崲鐣岄潰
function checkLogin() {
    const token = localStorage.getItem('trinet_token');
    const loginOverlay = document.getElementById('login-overlay');
    const appContainer = document.getElementById('app-container');
    if (token) {
        loginOverlay.style.display = 'none';
        appContainer.style.display = 'flex';
        renderMockRecords();
    } else {
        loginOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
    }
}

function renderMockRecords() {
    const tbody = document.getElementById('records-list');
    if (tbody) {
        tbody.innerHTML = `
            <tr class="record-group-start">
                <td class="font-mono">www</td>
                <td class="font-mono">example.com</td>
                <td><span class="badge badge-type">A</span></td>
                <td><span class="isp-dot ct"></span>鐢典俊 (CT)</td>
                <td class="font-mono">1.1.1.1</td>
                <td class="font-mono">60</td>
                <td>
                    <button class="btn btn-text" onclick="editRecord('www', 'example.com', 'ct', '1.1.1.1')">缂栬緫</button>
                    <button class="btn btn-text danger">鍒犻櫎</button>
                </td>
            </tr>
            <tr class="record-group-end">
                <td class="font-mono">www</td>
                <td class="font-mono">example.com</td>
                <td><span class="badge badge-type">A</span></td>
                <td><span class="isp-dot cu"></span>鑱旈€?(CU)</td>
                <td class="font-mono">2.2.2.2</td>
                <td class="font-mono">60</td>
                <td>
                    <button class="btn btn-text" onclick="editRecord('www', 'example.com', 'cu', '2.2.2.2')">缂栬緫</button>
                    <button class="btn btn-text danger">鍒犻櫎</button>
                </td>
            </tr>
        `;
    }
}

// 鎻愪氦鐧诲綍琛ㄥ崟
function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    // 闈欐€佹紨绀虹幆澧冿細绂荤嚎鏍￠獙 admin / admin123
    if (username === 'admin' && password === 'admin123') {
        localStorage.setItem('trinet_token', 'mock_token_123456');
        checkLogin();
    } else {
        alert('鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒锛侀粯璁よ处鎴蜂负 admin锛屽瘑鐮佷负 admin123');
    }
}

// 閫€鍑虹櫥褰?function logout() {
    localStorage.removeItem('trinet_token');
    checkLogin();
}

const passwordModal = document.getElementById('password-modal');
const passwordForm = document.getElementById('password-form');

function showPasswordModal() {
    passwordForm.reset();
    passwordModal.classList.add('show');
}

function closePasswordModal() {
    passwordModal.classList.remove('show');
}

function handlePasswordSubmit(event) {
    event.preventDefault();
    const oldPassword = document.getElementById('password-old').value.trim();
    const newUsername = document.getElementById('password-new-username').value.trim();
    const newPassword = document.getElementById('password-new').value.trim();
    const confirmPassword = document.getElementById('password-confirm').value.trim();

    if (newPassword !== confirmPassword) {
        alert('涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷达紒');
        return;
    }

    // 闈欐€佸師鍨嬬绾挎ā鎷熸垚鍔?    alert('瀵嗙爜淇敼鎴愬姛锛佸綋鍓嶄负闈欐€佹紨绀虹幆澧冿紝宸叉洿鏂版ā鎷熶細璇濆嚟璇侊紝璇烽噸鏂扮櫥褰曘€?);
    closePasswordModal();
    logout();
}

// 鏍囩椤靛垏鎹㈤€昏緫
function toggleSidebar(open) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        if (open) {
            sidebar.classList.add('open');
            overlay.classList.add('active');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    }
}

function switchTab(tabId) {
    // 鑷姩鎶樺彔渚ц竟鏍?    toggleSidebar(false);

    // 1. 鍒囨崲鑿滃崟婵€娲荤姸鎬?    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        if (item.getAttribute('href') === `#${tabId}`) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // 2. 鍒囨崲闈㈡澘鏄剧ず鐘舵€?    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // 3. 鏇存柊鏍囬鏍忔枃鏈?    const titleMap = {
        'dashboard': '鎺у埗鍙?,
        'records': '瑙ｆ瀽璁板綍',
        'ddns': '鍔ㄦ€?DNS 閰嶇疆',
        'orders': '璁㈠崟璁板綍',
        'logs': '绯荤粺杩愯鏃ュ織'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '鎺у埗鍙?;

    if (tabId === 'orders') {
        loadOrdersTable();
    }
}

// 妯℃€佸脊绐楃鐞?const modalOverlay = document.getElementById('record-modal');
const modalTitle = document.getElementById('modal-title');
const recordForm = document.getElementById('record-form');

// 椤甸潰鍔犺浇鍏ュ彛
window.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

function showAddModal() {
    modalTitle.innerText = '娣诲姞鍩熷悕瑙ｆ瀽';
    recordForm.reset();
    document.getElementById('input-subdomain').disabled = false;
    document.getElementById('input-domain').disabled = false;
    modalOverlay.classList.add('show');
}

function editRecord(subdomain, domain, isp, value) {
    modalTitle.innerText = '淇敼鍩熷悕瑙ｆ瀽';
    document.getElementById('input-subdomain').value = subdomain;
    document.getElementById('input-subdomain').disabled = true; // 缂栬緫鏃堕攣瀹氬瓙鍩熷悕
    document.getElementById('input-domain').value = domain;
    document.getElementById('input-domain').disabled = true; // 閿佸畾涓诲煙鍚?    document.getElementById('select-isp').value = isp; if (typeof setCascaderValue === 'function') setCascaderValue('select-isp', isp);
    document.getElementById('input-value').value = value;
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

function saveRecord(event) {
    event.preventDefault();
    // 鍚庣画瀵规帴鍚庣 API 鏃跺湪姝ゅ鎻愪氦鏁版嵁
    alert('淇濆瓨鎴愬姛 (褰撳墠涓洪潤鎬佸師鍨嬫紨绀?');
    closeModal();
}

function generateToken() {
    const randomHex = Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('');
    alert(`宸茬敓鎴愭柊 Token:\nddns_tok_${randomHex}\n璇峰Ε鍠勪繚绠°€俙);
}

function clearLogs() {
    const container = document.getElementById('log-container');
    if (container) {
        container.innerHTML = '<div class="log-row info">[' + new Date().toLocaleString() + '] [SYSTEM] 鏃ュ織缂撳瓨宸叉竻绌恒€?/div>';
    }
}

function handlePasswordSubmit(event) {
    event.preventDefault();
    const oldPass = document.getElementById('password-old').value;
    const newPass = document.getElementById('password-new').value;
    const confirmPass = document.getElementById('password-confirm').value;

    if (newPass !== confirmPass) {
        alert('涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷达紒');
        return;
    }
    alert('瀵嗙爜淇敼鎴愬姛 (褰撳墠涓洪潤鎬佸師鍨嬫紨绀?');
    closePasswordModal();
}

function loadOrdersTable() {
    console.log('璁㈠崟鏁版嵁鍔犺浇瀹屾瘯 (闈欐€佹紨绀烘ā寮?');
}

