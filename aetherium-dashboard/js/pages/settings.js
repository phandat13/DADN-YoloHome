import { THRESHOLDS } from '../config.js';
import { applyThresholds, resetThresholds } from '../store.js';
import { panel, pageTitle, toast } from '../ui.js';

const FIELDS = [
  ['TEMP_MAX', 'Nhiệt độ tối đa', '°C', 'Vượt ngưỡng: bật còi + quạt, ghi cảnh báo'],
  ['HUMIDITY_MIN', 'Độ ẩm tối thiểu', '%', 'Dưới mức này: cảnh báo độ ẩm'],
  ['HUMIDITY_MAX', 'Độ ẩm tối đa', '%', 'Trên mức này: cảnh báo độ ẩm'],
  ['LIGHT_MIN', 'Ánh sáng tối thiểu', 'Lux', 'Dưới mức này: tự bật đèn (chế độ tự động)'],
];

export const settingsPage = {
  mount(root) {
    const paint = () => {
      root.innerHTML = pageTitle('Cài đặt ngưỡng', 'Ngưỡng so sánh mỗi 30 giây với dữ liệu cảm biến') + `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          ${panel({ title: 'Ngưỡng cảnh báo', icon: 'settings', cls: 'lg:col-span-7', body: `
            <div class="space-y-4">
              ${FIELDS.map(([k, label, unit, hint]) => `
                <label class="flex items-center justify-between gap-4">
                  <span><span class="block text-sm font-semibold text-slate-800">${label}</span><span class="block text-xs text-slate-400">${hint}</span></span>
                  <span class="flex items-center gap-2"><input type="number" name="${k}" value="${THRESHOLDS[k]}" class="w-24 rounded-lg border-slate-200 text-sm text-right font-mono focus:border-sky-500 focus:ring-sky-500"><span class="text-xs text-slate-400 w-8">${unit}</span></span>
                </label>`).join('')}
            </div>
            <div class="flex gap-3 mt-6">
              <button id="save" type="button" class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">Lưu ngưỡng</button>
              <button id="reset" type="button" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">Khôi phục mặc định</button>
            </div>` })}
          ${panel({ title: 'Quy tắc tự động', icon: 'rule', cls: 'lg:col-span-5', body: `
            <ul class="text-sm text-slate-600 space-y-2 list-disc pl-5">
              <li>Cứ 30 giây: đọc nhiệt độ, độ ẩm, ánh sáng và so sánh ngưỡng.</li>
              <li>Nhiệt độ &gt; ${THRESHOLDS.TEMP_MAX}°C: bật còi, quạt 100% (chế độ tự động).</li>
              <li>PIR phát hiện chuyển động hoặc ánh sáng &lt; ${THRESHOLDS.LIGHT_MIN} Lux: bật đèn.</li>
              <li>Mọi cảnh báo được ghi vào mục Cảnh báo &amp; Lịch sử.</li>
            </ul>` })}
        </div>`;
      root.querySelector('#save').onclick = () => {
        const v = {};
        for (const [k] of FIELDS) v[k] = parseFloat(root.querySelector(`[name=${k}]`).value);
        if (Object.values(v).some((n) => !Number.isFinite(n))) return toast('Vui lòng nhập số hợp lệ', 'rose');
        if (v.HUMIDITY_MIN >= v.HUMIDITY_MAX) return toast('Độ ẩm tối thiểu phải nhỏ hơn tối đa', 'rose');
        if (v.HUMIDITY_MIN < 0 || v.HUMIDITY_MAX > 100) return toast('Độ ẩm phải trong khoảng 0–100%', 'rose');
        applyThresholds(v); paint(); toast('Đã lưu ngưỡng', 'emerald');
      };
      root.querySelector('#reset').onclick = () => { resetThresholds(); paint(); toast('Đã khôi phục mặc định', 'sky'); };
    };
    paint();
  },
};
