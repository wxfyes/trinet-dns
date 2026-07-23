// 检查登录状态并切换界面
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
                <td><span class="isp-dot ct"></span>电信 (CT)</td>
                <td class="font-mono">1.1.1.1</td>
                <td class="font-mono">60</td>
                <td>
                    <button class="btn btn-text" onclick="editRecord('www', 'example.com', 'ct', '1.1.1.1')">编辑</button>
                    <button class="btn btn-text danger">删除</button>
                </td>
            </tr>
            <tr class="record-group-end">
                <td class="font-mono">www</td>
                <td class="font-mono">example.com</td>
                <td><span class="badge badge-type">A</span></td>
                <td><span class="isp-dot cu"></span>联通 (CU)</td>
                <td class="font-mono">2.2.2.2</td>
                <td class="font-mono">60</td>
                <td>
                    <button class="btn btn-text" onclick="editRecord('www', 'example.com', 'cu', '2.2.2.2')">编辑</button>
                    <button class="btn btn-text danger">删除</button>
                </td>
            </tr>
        `;
    }
}

// 提交登录表单
function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    // 静态演示环境：离线校验 admin / admin123
    if (username === 'admin' && password === 'admin123') {
        localStorage.setItem('trinet_token', 'mock_token_123456');
        checkLogin();
    } else {
        alert('用户名或密码错误！默认账户为 admin，密码为 admin123');
    }
}

// 退出登录
function logout() {
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
        alert('两次输入的新密码不一致！');
        return;
    }

    // 静态原型离线模拟成功
    alert('密码修改成功！当前为静态演示环境，已更新模拟会话凭证，请重新登录。');
    closePasswordModal();
    logout();
}

// 标签页切换逻辑
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
    // 自动折叠侧边栏
    toggleSidebar(false);

    // 1. 切换菜单激活状态
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        if (item.getAttribute('href') === `#${tabId}`) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // 2. 切换面板显示状态
    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // 3. 更新标题栏文本
    const titleMap = {
        'dashboard': '控制台',
        'records': '解析记录',
        'ddns': '动态 DNS 配置',
        'orders': '订单记录',
        'logs': '系统运行日志'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '控制台';

    if (tabId === 'orders') {
        loadOrdersTable();
    }
}

// 模态弹窗管理
const modalOverlay = document.getElementById('record-modal');
const modalTitle = document.getElementById('modal-title');
const recordForm = document.getElementById('record-form');

// 页面加载入口
window.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

function showAddModal() {
    modalTitle.innerText = '添加域名解析';
    recordForm.reset();
    document.getElementById('input-subdomain').disabled = false;
    document.getElementById('input-domain').disabled = false;
    modalOverlay.classList.add('show');
}

function editRecord(subdomain, domain, isp, value) {
    modalTitle.innerText = '修改域名解析';
    document.getElementById('input-subdomain').value = subdomain;
    document.getElementById('input-subdomain').disabled = true; // 编辑时锁定子域名
    document.getElementById('input-domain').value = domain;
    document.getElementById('input-domain').disabled = true; // 锁定主域名
    document.getElementById('select-isp').value = isp;
    if (typeof setCascaderValue === 'function') setCascaderValue('select-isp', isp);
    document.getElementById('input-value').value = value;
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

function saveRecord(event) {
    event.preventDefault();
    // 后续对接后端 API 时在此处提交数据
    alert('保存成功 (当前为静态原型演示)');
    closeModal();
}

function generateToken() {
    const randomHex = Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('');
    alert(`已生成新 Token:\nddns_tok_${randomHex}\n请妥善保管。`);
}

function clearLogs() {
    const container = document.getElementById('log-container');
    if (container) {
        container.innerHTML = '<div class="log-row info">[' + new Date().toLocaleString() + '] [SYSTEM] 日志缓存已清空。</div>';
    }
}

function handlePasswordSubmit(event) {
    event.preventDefault();
    const oldPass = document.getElementById('password-old').value;
    const newPass = document.getElementById('password-new').value;
    const confirmPass = document.getElementById('password-confirm').value;

    if (newPass !== confirmPass) {
        alert('两次输入的新密码不一致！');
        return;
    }
    alert('密码修改成功 (当前为静态原型演示)');
    closePasswordModal();
}

function loadOrdersTable() {
    console.log('订单数据加载完毕 (静态演示模式)');
}


async function saveTGBackupSettings(event) {
    event.preventDefault();
    const token = document.getElementById('setting-tg-bot-token').value.trim();
    const chatId = document.getElementById('setting-tg-chat-id').value.trim();
    let time = document.getElementById('setting-tg-backup-time').value.trim();
    if (!time) time = "02:00";

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tg_bot_token: token,
                tg_chat_id: chatId,
                tg_backup_time: time
            })
        });

        if (res.ok) {
            alert('Telegram 备份配置保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('网络错误: ' + err.message);
    }
}
