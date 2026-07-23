const ispTreeData = [
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
    const wrapper = document.getElementById(`cascader-wrapper-${id}`);
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
    const wrapper = document.getElementById(`cascader-wrapper-${id}`);
    if (wrapper.getAttribute("disabled") === "true") return;
    
    // Close other cascaders
    document.querySelectorAll(".cascader-dropdown").forEach(d => {
        if (d !== wrapper.querySelector(".cascader-dropdown")) d.classList.remove("show");
    });

    const dropdown = wrapper.querySelector(".cascader-dropdown");
    dropdown.classList.toggle("show");
}

function selectValue(id, value, label) {
    const wrapper = document.getElementById(`cascader-wrapper-${id}`);
    const input = document.getElementById(id);
    const display = document.getElementById(`cascader-display-${id}`);
    const dropdown = wrapper.querySelector(".cascader-dropdown");
    
    input.value = value;
    display.innerText = label;
    dropdown.classList.remove("show");
}

// Helper for external scripts to set the value programmatically
function setCascaderValue(id, value) {
    const input = document.getElementById(id);
    const display = document.getElementById(`cascader-display-${id}`);
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
