const fs = require('fs');

const cascaderJs = `const ispTreeData = [
    { label: '默认 (Default)', value: 'def' },
    {
        label: '中国电信 (CT)',
        children: [
            { label: '全网电信 (默认)', value: 'ct' },
            { label: '北京电信', value: 'ct_bj' },
            { label: '天津电信', value: 'ct_tj' },
            { label: '河北电信', value: 'ct_he' },
            { label: '山西电信', value: 'ct_sx' },
            { label: '内蒙古电信', value: 'ct_nm' },
            { label: '辽宁电信', value: 'ct_ln' },
            { label: '吉林电信', value: 'ct_jl' },
            { label: '黑龙江电信', value: 'ct_hl' },
            { label: '上海电信', value: 'ct_sh' },
            { label: '江苏电信', value: 'ct_js' },
            { label: '浙江电信', value: 'ct_zj' },
            { label: '安徽电信', value: 'ct_ah' },
            { label: '福建电信', value: 'ct_fj' },
            { label: '江西电信', value: 'ct_jx' },
            { label: '山东电信', value: 'ct_sd' },
            { label: '河南电信', value: 'ct_ha' },
            { label: '湖北电信', value: 'ct_hb' },
            { label: '湖南电信', value: 'ct_hn' },
            { label: '广东电信', value: 'ct_gd' },
            { label: '广西电信', value: 'ct_gx' },
            { label: '海南电信', value: 'ct_hi' },
            { label: '重庆电信', value: 'ct_cq' },
            { label: '四川电信', value: 'ct_sc' },
            { label: '贵州电信', value: 'ct_gz' },
            { label: '云南电信', value: 'ct_yn' },
            { label: '西藏电信', value: 'ct_xz' },
            { label: '陕西电信', value: 'ct_sn' },
            { label: '甘肃电信', value: 'ct_gs' },
            { label: '青海电信', value: 'ct_qh' },
            { label: '宁夏电信', value: 'ct_nx' },
            { label: '新疆电信', value: 'ct_xj' },
            { label: '台湾 (CT)', value: 'ct_tw' },
            { label: '香港 (CT)', value: 'ct_xg' },
            { label: '澳门 (CT)', value: 'ct_am' }
        ]
    },
    {
        label: '中国联通 (CU)',
        children: [
            { label: '全网联通 (默认)', value: 'cu' },
            { label: '北京联通', value: 'cu_bj' },
            { label: '天津联通', value: 'cu_tj' },
            { label: '河北联通', value: 'cu_he' },
            { label: '山西联通', value: 'cu_sx' },
            { label: '内蒙古联通', value: 'cu_nm' },
            { label: '辽宁联通', value: 'cu_ln' },
            { label: '吉林联通', value: 'cu_jl' },
            { label: '黑龙江联通', value: 'cu_hl' },
            { label: '上海联通', value: 'cu_sh' },
            { label: '江苏联通', value: 'cu_js' },
            { label: '浙江联通', value: 'cu_zj' },
            { label: '安徽联通', value: 'cu_ah' },
            { label: '福建联通', value: 'cu_fj' },
            { label: '江西联通', value: 'cu_jx' },
            { label: '山东联通', value: 'cu_sd' },
            { label: '河南联通', value: 'cu_ha' },
            { label: '湖北联通', value: 'cu_hb' },
            { label: '湖南联通', value: 'cu_hn' },
            { label: '广东联通', value: 'cu_gd' },
            { label: '广西联通', value: 'cu_gx' },
            { label: '海南联通', value: 'cu_hi' },
            { label: '重庆联通', value: 'cu_cq' },
            { label: '四川联通', value: 'cu_sc' },
            { label: '贵州联通', value: 'cu_gz' },
            { label: '云南联通', value: 'cu_yn' },
            { label: '西藏联通', value: 'cu_xz' },
            { label: '陕西联通', value: 'cu_sn' },
            { label: '甘肃联通', value: 'cu_gs' },
            { label: '青海联通', value: 'cu_qh' },
            { label: '宁夏联通', value: 'cu_nx' },
            { label: '新疆联通', value: 'cu_xj' },
            { label: '台湾 (CU)', value: 'cu_tw' },
            { label: '香港 (CU)', value: 'cu_xg' },
            { label: '澳门 (CU)', value: 'cu_am' }
        ]
    },
    {
        label: '中国移动 (CM)',
        children: [
            { label: '全网移动 (默认)', value: 'cm' },
            { label: '北京移动', value: 'cm_bj' },
            { label: '天津移动', value: 'cm_tj' },
            { label: '河北移动', value: 'cm_he' },
            { label: '山西移动', value: 'cm_sx' },
            { label: '内蒙古移动', value: 'cm_nm' },
            { label: '辽宁移动', value: 'cm_ln' },
            { label: '吉林移动', value: 'cm_jl' },
            { label: '黑龙江移动', value: 'cm_hl' },
            { label: '上海移动', value: 'cm_sh' },
            { label: '江苏移动', value: 'cm_js' },
            { label: '浙江移动', value: 'cm_zj' },
            { label: '安徽移动', value: 'cm_ah' },
            { label: '福建移动', value: 'cm_fj' },
            { label: '江西移动', value: 'cm_jx' },
            { label: '山东移动', value: 'cm_sd' },
            { label: '河南移动', value: 'cm_ha' },
            { label: '湖北移动', value: 'cm_hb' },
            { label: '湖南移动', value: 'cm_hn' },
            { label: '广东移动', value: 'cm_gd' },
            { label: '广西移动', value: 'cm_gx' },
            { label: '海南移动', value: 'cm_hi' },
            { label: '重庆移动', value: 'cm_cq' },
            { label: '四川移动', value: 'cm_sc' },
            { label: '贵州移动', value: 'cm_gz' },
            { label: '云南移动', value: 'cm_yn' },
            { label: '西藏移动', value: 'cm_xz' },
            { label: '陕西移动', value: 'cm_sn' },
            { label: '甘肃移动', value: 'cm_gs' },
            { label: '青海移动', value: 'cm_qh' },
            { label: '宁夏移动', value: 'cm_nx' },
            { label: '新疆移动', value: 'cm_xj' },
            { label: '台湾 (CM)', value: 'cm_tw' },
            { label: '香港 (CM)', value: 'cm_xg' },
            { label: '澳门 (CM)', value: 'cm_am' }
        ]
    }
];

function initCascader(id) {
    const wrapper = document.getElementById(\`cascader-wrapper-\${id}\`);
    if (!wrapper) return;
    
    // Create dropdown container
    const dropdown = document.createElement("div");
    dropdown.className = "cascader-dropdown";
    wrapper.appendChild(dropdown);

    // Create first level menu
    const menu1 = document.createElement("ul");
    menu1.className = "cascader-menu";
    dropdown.appendChild(menu1);

    // Create second level menu
    const menu2 = document.createElement("ul");
    menu2.className = "cascader-menu cascader-menu-right";
    menu2.style.display = "none";
    dropdown.appendChild(menu2);

    let activeItem1 = null;

    // Render first level
    ispTreeData.forEach((item1, idx) => {
        const li = document.createElement("li");
        li.className = "cascader-item" + (item1.children ? " has-children" : "");
        li.innerText = item1.label;
        
        li.addEventListener("mouseenter", () => {
            if (activeItem1) activeItem1.classList.remove("active");
            li.classList.add("active");
            activeItem1 = li;

            if (item1.children) {
                menu2.style.display = "block";
                menu2.innerHTML = ""; // clear old
                item1.children.forEach(item2 => {
                    const li2 = document.createElement("li");
                    li2.className = "cascader-item";
                    li2.innerText = item2.label;
                    li2.addEventListener("click", (e) => {
                        e.stopPropagation();
                        selectValue(id, item2.value, item2.label);
                    });
                    menu2.appendChild(li2);
                });
            } else {
                menu2.style.display = "none";
            }
        });

        li.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!item1.children) {
                selectValue(id, item1.value, item1.label);
            }
        });

        menu1.appendChild(li);
    });
}

function toggleCascader(id) {
    const wrapper = document.getElementById(\`cascader-wrapper-\${id}\`);
    if (wrapper.getAttribute("disabled") === "true") return;
    
    // Close other cascaders
    document.querySelectorAll(".cascader-dropdown").forEach(d => {
        if (d !== wrapper.querySelector(".cascader-dropdown")) d.classList.remove("show");
    });

    const dropdown = wrapper.querySelector(".cascader-dropdown");
    dropdown.classList.toggle("show");
}

function selectValue(id, value, label) {
    const wrapper = document.getElementById(\`cascader-wrapper-\${id}\`);
    const input = document.getElementById(id);
    const display = document.getElementById(\`cascader-display-\${id}\`);
    const dropdown = wrapper.querySelector(".cascader-dropdown");
    
    input.value = value;
    display.innerText = label;
    dropdown.classList.remove("show");
}

// Helper for external scripts to set the value programmatically
function setCascaderValue(id, value) {
    const input = document.getElementById(id);
    const display = document.getElementById(\`cascader-display-\${id}\`);
    if (!input || !display) return;
    
    input.value = value;
    let foundLabel = value;
    
    for (let item1 of ispTreeData) {
        if (item1.value === value) {
            foundLabel = item1.label;
            break;
        }
        if (item1.children) {
            for (let item2 of item1.children) {
                if (item2.value === value) {
                    foundLabel = item2.label;
                    break;
                }
            }
        }
    }
    display.innerText = foundLabel;
}

// Close when click outside
document.addEventListener("click", (e) => {
    document.querySelectorAll(".custom-cascader").forEach(wrapper => {
        if (!wrapper.contains(e.target)) {
            const dropdown = wrapper.querySelector(".cascader-dropdown");
            if (dropdown) dropdown.classList.remove("show");
        }
    });
});

document.addEventListener("DOMContentLoaded", () => {
    initCascader("select-isp");
    initCascader("ddns-select-isp");
});
`;

fs.writeFileSync('web/cascader.js', cascaderJs, 'utf8');
fs.writeFileSync('pkg/web/static/cascader.js', cascaderJs, 'utf8');

const css = `
/* Cascader Styles */
.custom-cascader { position: relative; user-select: none; }
.cascader-display { cursor: pointer; background: #fff url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") no-repeat right 0.75rem center/12px; padding-right: 2rem; }
.custom-cascader[disabled='true'] .cascader-display { background-color: var(--bg-tertiary); cursor: not-allowed; opacity: 0.7; }
.cascader-dropdown { position: absolute; top: 100%; left: 0; margin-top: 4px; background: #fff; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); z-index: 1000; display: none; flex-direction: row; min-width: 160px; }
.cascader-dropdown.show { display: flex; }
.cascader-menu { list-style: none; margin: 0; padding: 4px 0; max-height: 250px; overflow-y: auto; border-right: 1px solid var(--border-color); min-width: 150px; }
.cascader-menu:last-child { border-right: none; }
.cascader-item { padding: 8px 16px; cursor: pointer; font-size: 0.9rem; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center; }
.cascader-item:hover, .cascader-item.active { background-color: var(--bg-secondary); color: var(--primary-color); }
.cascader-item.has-children::after { content: "▶"; font-size: 0.6rem; color: var(--text-muted); }
.cascader-item.active.has-children::after { color: var(--primary-color); }
`;

function processIndex(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    
    const regex1 = /<select id="select-isp" class="form-control">[\s\S]*?<\/select>/;
    const repl1 = `<div class="custom-cascader" id="cascader-wrapper-select-isp" onclick="toggleCascader('select-isp')">
                                <div class="cascader-display form-control" id="cascader-display-select-isp">默认 (Default)</div>
                                <input type="hidden" id="select-isp" value="def">
                            </div>`;
    content = content.replace(regex1, repl1);
    
    const regex2 = /<select id="ddns-select-isp" class="form-control">[\s\S]*?<\/select>/;
    const repl2 = `<div class="custom-cascader" id="cascader-wrapper-ddns-select-isp" onclick="toggleCascader('ddns-select-isp')">
                                <div class="cascader-display form-control" id="cascader-display-ddns-select-isp">默认 (Default)</div>
                                <input type="hidden" id="ddns-select-isp" value="def">
                            </div>`;
    content = content.replace(regex2, repl2);

    content = content.replace('<script src="app.js"></script>', '<script src="cascader.js"></script>\n    <script src="app.js"></script>');
    
    fs.writeFileSync(filepath, content, 'utf8');
}

function processAppJs(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    
    const targetSetVal = "document.getElementById('select-isp').value = isp;";
    const replSetVal = "document.getElementById('select-isp').value = isp;\n    if (typeof setCascaderValue === 'function') setCascaderValue('select-isp', isp);";
    content = content.replace(targetSetVal, replSetVal);
    
    const targetDisable = "document.getElementById('select-isp').disabled = true;";
    const replDisable = "document.getElementById('cascader-wrapper-select-isp').setAttribute('disabled', 'true');";
    content = content.replace(targetDisable, replDisable);
    
    const targetEnable = "document.getElementById('select-isp').disabled = false;";
    const replEnable = "document.getElementById('cascader-wrapper-select-isp').removeAttribute('disabled');";
    content = content.replace(targetEnable, replEnable);

    fs.writeFileSync(filepath, content, 'utf8');
}

function processCss(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    if (!content.includes('.custom-cascader')) {
        content += "\n" + css;
        fs.writeFileSync(filepath, content, 'utf8');
    }
}

processIndex('web/index.html');
processIndex('pkg/web/static/index.html');
processAppJs('web/app.js');
processAppJs('pkg/web/static/app.js');
processCss('web/style.css');
processCss('pkg/web/static/style.css');
