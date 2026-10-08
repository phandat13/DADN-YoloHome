// Thông báo: GET /notifications?status=Unread|Read, PATCH /notifications/:id/read, PATCH /notifications/read-all
import { state, refreshNotifications } from '../store.js';
import { api } from '../api.js';
import { asList, esc, fullTime } from '../utils/fields.js';
import { normNotification } from '../models.js';
import { panel, pageTitle, badge, segmented, button, emptyState, loadingBlock, errorBlock, toast, busy, fail } from '../ui.js';

let filter = 'Unread';

export const notificationsPage = {
  mount(root) {
    let items = null, error = null, alive = true;
    root.innerHTML = pageTitle('Thông báo', 'Thông báo gửi tới tài khoản của bạn — bấm vào thông báo để đánh dấu đã đọc',
      button('Tải lại', { act: 'reload', tone: 'secondary', icon: 'refresh' })) + '<div id="notif-box"></div>';
    const box = root.querySelector('#notif-box');

    const paint = () => {
      let body;
      if (items === null) body = loadingBlock();
      else if (error) body = errorBlock(error);
      else if (!items.length) body = emptyState('notifications_off', filter === 'Unread' ? 'Không có thông báo chưa đọc' : 'Không có thông báo');
      else {
        body = `<div class="divide-y divide-slate-100">${items.map((n) => `
          <div data-act="${n.read ? '' : 'read'}" data-val="${esc(n.id)}" class="flex items-start gap-3 py-3 px-2 -mx-2 rounded-lg ${n.read ? '' : 'cursor-pointer hover:bg-sky-50/60'}">
            <span class="mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-slate-200' : 'bg-sky-500'}"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm ${n.read ? 'text-slate-600' : 'font-semibold text-slate-900'}">${esc(n.title)}</span>${badge(n.read ? 'Đã đọc' : 'Chưa đọc', n.read ? 'slate' : 'sky')}
              </div>
              ${n.content ? `<div class="text-sm text-slate-600 mt-0.5 break-words">${esc(n.content)}</div>` : ''}
              <div class="text-[11px] font-mono text-slate-400 mt-1">${fullTime(n.ts)}</div>
            </div>
          </div>`).join('')}</div>`;
      }
      const unreadHere = items?.filter((n) => !n.read).length ?? 0;
      box.innerHTML = panel({
        title: `Hộp thông báo${items ? ` (${items.length})` : ''}`, icon: 'notifications',
        right: `<div class="flex items-center gap-2">
          ${unreadHere ? button('Đánh dấu tất cả đã đọc', { act: 'read-all', tone: 'secondary', size: 'sm', icon: 'done_all' }) : ''}
          ${segmented([['Unread', `Chưa đọc${state.unread ? ` (${state.unread})` : ''}`], ['Read', 'Đã đọc'], ['All', 'Tất cả']], filter, 'filter')}</div>`,
        body,
      });
    };

    const load = async () => {
      try {
        const res = await api.notifications.list(filter === 'All' ? undefined : filter);
        if (!alive) return;
        items = asList(res, 'notifications').map(normNotification).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        if (filter === 'Unread') items = items.filter((n) => !n.read);
        if (filter === 'Read') items = items.filter((n) => n.read);
        error = null;
      } catch (e) {
        if (!alive) return;
        items = [];
        error = `Không tải được thông báo: ${e.message}`;
      }
      paint();
    };

    const markRead = async (n) => {
      await api.notifications.markRead(n.id);
      n.read = true;
      n.status = 'Read';
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !b.dataset.act) return;
      const { act, val } = b.dataset;

      if (act === 'filter') {
        filter = val;
        items = null;
        paint();
        return load();
      }

      if (act === 'reload') {
        items = null;
        paint();
        await busy(b, load);
        return refreshNotifications();
      }

      // Đánh dấu 1 thông báo
      if (act === 'read') {
        const n = items?.find((x) => String(x.id) === String(val));
        if (!n) return;
        try {
          await markRead(n);
          if (state.unread > 0) state.unread -= 1;
          if (filter === 'Unread') items = items.filter((x) => x !== n);
          paint();
          refreshNotifications();
        } catch (err) {
          fail(err, 'Không đánh dấu được');
        }
      }

      // Đánh dấu TẤT CẢ thông báo
      if (act === 'read-all') {
        await busy(b, async () => {
          try {
            // Thử gọi API đọc tất cả tập trung
            if (api.notifications.markAllRead) {
              await api.notifications.markAllRead();
            } else if (api.patch) {
              await api.patch('/notifications/read-all');
            } else {
              // Fallback nếu api.js chưa khai báo method riêng
              const unread = items.filter((n) => !n.read);
              await Promise.allSettled(unread.map(markRead));
            }

            toast('Đã đánh dấu tất cả là đã đọc', 'emerald');
            
            // Cập nhật state UI ngay lập tức
            state.unread = 0;
            if (items) {
              items.forEach((n) => {
                n.read = true;
                n.status = 'Read';
              });
              if (filter === 'Unread') items = [];
            }
            paint();
            await refreshNotifications();
          } catch (err) {
            fail(err, 'Không đánh dấu tất cả được');
          }
        });
      }
    });

    paint();
    load();
    return () => { alive = false; };
  },
};

