// Thành viên: GET/POST /homes/:homeId/members, PUT/DELETE /homes/:homeId/members/:userId
import { state } from '../store.js';
import { api } from '../api.js';
import { MEMBER_ROLES } from '../config.js';
import { asList, esc, fmtDate, toDateInput, toTs } from '../utils/fields.js';
import { normMember } from '../models.js';
import { panel, pageTitle, badge, button, field, inputCls, emptyState, loadingBlock, errorBlock, toast, busy, formValues, fail } from '../ui.js';

const isOwner = (role) => /owner|chu nha|chủ nhà/i.test(role);
const roleTone = (role) => (isOwner(role) ? 'amber' : /guest|khach/i.test(role) ? 'slate' : 'sky');
const initials = (s = '') => s.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';

export const membersPage = {
  mount(root) {
    let members = null, error = null, editing = null, alive = true;
    const homeId = state.homeId;
    root.innerHTML = pageTitle('Thành viên', `Thành viên của nhà <b>${esc(state.home?.name ?? '')}</b> — thêm, đổi vai trò, gia hạn hoặc xoá`,
      button('Tải lại', { act: 'reload', tone: 'secondary', icon: 'refresh' })) + `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div id="member-list" class="lg:col-span-8"></div>
        <div class="lg:col-span-4">${panel({ title: 'Mời thành viên', icon: 'person_add', body: `
          <form id="add-member" class="space-y-3">
            ${field('Email *', `<input name="email" type="email" required class="${inputCls}" placeholder="nguoi.dung@email.com">`)}
            ${field('Vai trò', `<select name="roleName" class="${inputCls}">${MEMBER_ROLES.map((r) => `<option>${r}</option>`).join('')}</select>`)}
            ${field('Hết hạn', `<input name="expired" type="date" class="${inputCls}">`, 'Để trống nếu không giới hạn thời gian')}
            ${button('Thêm thành viên', { type: 'submit', icon: 'send' })}
            <p class="text-[11px] text-slate-400">Cần quyền MEMBER_MANAGE. Người được mời phải có tài khoản với email này.</p>
          </form>` })}</div>
      </div>`;
    const listEl = root.querySelector('#member-list');

    const row = (m) => {
      const me = state.user && String(state.user.id) === String(m.userId);
      const expiredTs = toTs(m.expired);
      const expiredSoon = expiredTs && expiredTs < Date.now();
      if (String(editing) === String(m.userId)) {
        return `<tr class="bg-sky-50/40 border-b border-slate-100">
          <td class="py-3 pr-4"><div class="font-semibold text-slate-800">${esc(m.name || m.email)}</div><div class="text-xs text-slate-400">${esc(m.email)}</div></td>
          <td class="py-3 pr-4"><select name="roleName" form="edit-member" class="rounded-lg border-slate-200 text-sm">${MEMBER_ROLES.map((r) => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
          <td class="py-3 pr-4"><input name="expired" form="edit-member" type="date" value="${toDateInput(m.expired)}" class="rounded-lg border-slate-200 text-sm"></td>
          <td class="py-3 text-right whitespace-nowrap">${button('Lưu', { type: 'submit', size: 'sm', attrs: 'form="edit-member"' })} ${button('Huỷ', { act: 'cancel', tone: 'secondary', size: 'sm' })}</td>
        </tr>`;
      }
      return `<tr class="border-b border-slate-50">
        <td class="py-3 pr-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs shrink-0">${esc(initials(m.name || m.email))}</div>
            <div class="min-w-0"><div class="font-semibold text-slate-800">${esc(m.name || '—')}${me ? ' <span class="text-xs text-slate-400 font-normal">(bạn)</span>' : ''}</div>
              <div class="text-xs text-slate-400">${esc(m.email)} · ID ${esc(m.userId)}</div></div>
          </div>
        </td>
        <td class="py-3 pr-4">${m.role ? badge(m.role, roleTone(m.role)) : '—'}${m.state ? ` ${badge(m.state, 'slate')}` : ''}</td>
        <td class="py-3 pr-4 text-sm ${expiredSoon ? 'text-rose-600 font-semibold' : 'text-slate-600'}">${m.expired ? fmtDate(m.expired) : 'Không giới hạn'}</td>
        <td class="py-3 text-right whitespace-nowrap">${isOwner(m.role) ? '<span class="text-xs text-slate-400">Chủ nhà</span>' : `
          ${button('', { act: 'edit', val: m.userId, tone: 'ghost', icon: 'edit', size: 'sm', attrs: 'title="Đổi vai trò / gia hạn"' })}
          ${button('', { act: 'delete', val: m.userId, tone: 'danger', icon: 'person_remove', size: 'sm', attrs: 'title="Xoá khỏi nhà"' })}`}
        </td>
      </tr>`;
    };

    const paint = () => {
      let body;
      if (members === null) body = loadingBlock();
      else if (error && !members.length) body = errorBlock(error);
      else if (!members.length) body = emptyState('group', 'Chưa có thành viên');
      else {
        body = `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th class="py-2 pr-4 font-semibold">Thành viên</th><th class="py-2 pr-4 font-semibold">Vai trò</th><th class="py-2 pr-4 font-semibold">Hết hạn</th><th></th></tr></thead>
          <tbody>${members.map(row).join('')}</tbody></table></div>
          <form id="edit-member" data-id="${esc(editing ?? '')}"></form>`;
      }
      listEl.innerHTML = panel({ title: `Danh sách thành viên${members ? ` (${members.length})` : ''}`, icon: 'group', body });
    };

    const load = async () => {
      try {
        const res = await api.members.list(homeId);
        if (!alive) return;
        members = asList(res, 'members').map(normMember);
        error = null;
      } catch (e) {
        if (!alive) return;
        members = members ?? [];
        error = `Không tải được thành viên: ${e.message}`;
      }
      paint();
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      const m = members?.find((x) => String(x.userId) === String(val));
      if (act === 'reload') return busy(b, load);
      if (act === 'edit') { editing = val; return paint(); }
      if (act === 'cancel') { editing = null; return paint(); }
      if (act === 'delete' && m) {
        if (!confirm(`Xoá ${m.name || m.email} khỏi nhà?`)) return;
        await busy(b, async () => {
          try { await api.members.remove(homeId, m.userId); toast('Đã xoá thành viên', 'emerald'); await load(); }
          catch (err) { fail(err, 'Không xoá được'); }
        });
      }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      const btn = f.id === 'edit-member' ? root.querySelector('[form="edit-member"][type=submit]') : f.querySelector('[type=submit]');
      if (f.id === 'add-member') {
        if (!/^\S+@\S+\.\S+$/.test(v.email)) return toast('Email không hợp lệ', 'rose');
        await busy(btn, async () => {
          try {
            const body = { email: v.email, roleName: v.roleName };
            if (v.expired) body.expired = v.expired;
            await api.members.add(homeId, body);
            f.reset();
            toast('Đã thêm thành viên', 'emerald');
            await load();
          } catch (err) { fail(err, 'Không thêm được thành viên'); }
        });
      } else if (f.id === 'edit-member') {
        await busy(btn, async () => {
          try {
            await api.members.update(homeId, f.dataset.id, { roleName: v.roleName, expired: v.expired || null });
            toast('Đã cập nhật thành viên', 'emerald');
            editing = null;
            await load();
          } catch (err) { fail(err, 'Không cập nhật được'); }
        });
      }
    });

    paint();
    load();
    return () => { alive = false; };
  },
};
