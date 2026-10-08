// Quản lý nhà: GET/POST /homes, GET/PUT/DELETE /homes/:homeId
import { state, on, loadHomes, selectHome } from '../store.js';
import { api } from '../api.js';
import { asObject, esc } from '../utils/fields.js';
import { normHome } from '../models.js';
import { panel, pageTitle, badge, button, field, inputCls, emptyState, errorBlock, toast, busy, formValues, fail } from '../ui.js';

export const homesPage = {
  mount(root) {
    let editing = null;
    root.innerHTML = pageTitle('Nhà của tôi', 'Các ngôi nhà bạn là thành viên (đang hoạt động, chưa hết hạn)',
      button('Tải lại', { act: 'reload', tone: 'secondary', icon: 'refresh' })) + `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div id="home-list" class="lg:col-span-8 space-y-4"></div>
        <div class="lg:col-span-4">${panel({ title: 'Tạo nhà mới', icon: 'add_home', body: `
          <form id="create-home" class="space-y-3">
            ${field('Tên nhà *', `<input name="homeName" required class="${inputCls}" placeholder="VD: Nhà Quận 7">`)}
            ${field('Địa chỉ', `<input name="address" class="${inputCls}" placeholder="Không bắt buộc">`)}
            ${button('Tạo nhà', { type: 'submit', icon: 'add' })}
            <p class="text-[11px] text-slate-400">Người tạo tự động trở thành Chủ nhà (Owner).</p>
          </form>` })}</div>
      </div>
      <datalist id="home-states"><option value="Active"></option><option value="Inactive"></option></datalist>`;
    const listEl = root.querySelector('#home-list');
    const find = (id) => state.homes.find((h) => String(h.id) === String(id));

    const card = (h) => {
      const current = String(h.id) === String(state.homeId);
      const frame = `bg-white rounded-xl p-5 border shadow-sm ${current ? 'border-sky-300 ring-2 ring-sky-100' : 'border-slate-200/80'}`;
      if (String(editing) === String(h.id)) {
        return `<form data-form="edit-home" data-id="${esc(h.id)}" class="${frame} grid sm:grid-cols-3 gap-3 items-end">
          ${field('Tên nhà', `<input name="homeName" required value="${esc(h.name)}" class="${inputCls}">`)}
          ${field('Địa chỉ', `<input name="address" value="${esc(h.address)}" class="${inputCls}">`)}
          ${field('Trạng thái', `<input name="state" list="home-states" value="${esc(h.state)}" class="${inputCls}">`)}
          <div class="sm:col-span-3 flex gap-2">${button('Lưu', { type: 'submit', icon: 'save' })}${button('Huỷ', { act: 'cancel', tone: 'secondary' })}</div>
        </form>`;
      }
      return `<div class="${frame}">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3 min-w-0">
            <div class="w-10 h-10 shrink-0 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><span class="material-symbols-outlined">home</span></div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900">${esc(h.name)}</span>
                ${current ? badge('Đang chọn', 'sky') : ''}${h.role ? badge(h.role, /owner/i.test(h.role) ? 'amber' : 'slate') : ''}${h.state ? badge(h.state, /inactive|lock/i.test(h.state) ? 'rose' : 'emerald') : ''}
              </div>
              <div class="text-xs text-slate-500 mt-0.5">${esc(h.address || 'Chưa có địa chỉ')} · ID ${esc(h.id)}</div>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            ${current ? '' : button('Chọn', { act: 'select', val: h.id, size: 'sm' })}
            ${button('', { act: 'edit', val: h.id, tone: 'ghost', icon: 'edit', size: 'sm', attrs: 'title="Sửa (cần quyền HOME_UPDATE)"' })}
            ${button('', { act: 'delete', val: h.id, tone: 'danger', icon: 'delete', size: 'sm', attrs: 'title="Xoá (chỉ Owner)"' })}
          </div>
        </div>
      </div>`;
    };

    const paint = () => {
      if (state.errors.homes && !state.homes.length) { listEl.innerHTML = errorBlock(`Không tải được danh sách nhà: ${state.errors.homes}`); return; }
      if (!state.homes.length) {
        listEl.innerHTML = `<div class="bg-white rounded-xl border border-slate-200/80 shadow-sm">${emptyState('home_work', 'Bạn chưa thuộc ngôi nhà nào', 'Tạo nhà mới ở khung bên phải hoặc nhờ chủ nhà mời bạn qua email.')}</div>`;
        return;
      }
      listEl.innerHTML = state.homes.map(card).join('');
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      const home = find(val);
      if (act === 'reload') return busy(b, loadHomes);
      if (act === 'select' && home) return selectHome(home.id).then(() => toast(`Đã chuyển sang "${home.name}"`, 'sky'));
      if (act === 'edit') { editing = val; return paint(); }
      if (act === 'cancel') { editing = null; return paint(); }
      if (act === 'delete' && home) {
        if (!confirm(`Xoá nhà "${home.name}"? Toàn bộ dữ liệu của nhà sẽ bị xoá và không thể hoàn tác.`)) return;
        await busy(b, async () => {
          try {
            await api.homes.remove(home.id);
            toast('Đã xoá nhà', 'emerald');
            const wasCurrent = String(home.id) === String(state.homeId);
            await loadHomes();
            if (wasCurrent) await selectHome(state.homes[0]?.id ?? null);
          } catch (err) { fail(err, 'Không xoá được nhà'); }
        });
      }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      const btn = f.querySelector('[type=submit]');
      if (f.id === 'create-home') {
        if (!v.homeName) return toast('Vui lòng nhập tên nhà', 'rose');
        await busy(btn, async () => {
          try {
            const res = await api.homes.create({ homeName: v.homeName, address: v.address || undefined });
            f.reset();
            toast('Đã tạo nhà mới', 'emerald');
            const created = normHome(asObject(res, 'home') ?? {});
            await loadHomes();
            if (state.homeId == null) {
              const target = state.homes.find((h) => created.id != null && String(h.id) === String(created.id)) ?? state.homes.at(-1);
              if (target) await selectHome(target.id);
            }
          } catch (err) { fail(err, 'Không tạo được nhà'); }
        });
      } else if (f.dataset.form === 'edit-home') {
        if (!v.homeName) return toast('Tên nhà không được để trống', 'rose');
        await busy(btn, async () => {
          try {
            const body = { homeName: v.homeName, address: v.address };
            if (v.state) body.state = v.state;
            await api.homes.update(f.dataset.id, body);
            toast('Đã cập nhật thông tin nhà', 'emerald');
            editing = null;
            await loadHomes();
          } catch (err) { fail(err, 'Không cập nhật được'); }
        });
      }
    });

    paint();
    const off = on('homes', () => { if (editing == null) paint(); });
    return () => off();
  },
};
