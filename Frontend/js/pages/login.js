// Đăng nhập / đăng ký: POST /auth/login, POST /auth/register (public).
import { login, register } from '../store.js';
import { DEVICE } from '../config.js';
import { esc } from '../utils/fields.js';
import { inputCls, field, button, segmented, errorBlock, formValues, busy, toast } from '../ui.js';

let lastEmail = '';

export const loginPage = {
  mount(root) {
    let tab = 'login';

    const paint = () => {
      const reg = tab === 'register';
      root.innerHTML = `
        <div class="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div class="w-full max-w-md">
            <div class="flex items-center gap-3 justify-center mb-6">
              <img src="${DEVICE.logo}" alt="" class="h-11 w-11 rounded-xl ring-1 ring-slate-200 object-cover">
              <div>
                <div class="font-bold text-slate-900 text-xl font-['Space_Grotesk'] leading-none">${DEVICE.brand}</div>
                <div class="text-[11px] font-semibold tracking-wider text-sky-600 uppercase mt-1">${DEVICE.platform} · YoloHome</div>
              </div>
            </div>
            <section class="bg-white rounded-2xl p-7 border border-slate-200/80 shadow-sm">
              <div class="flex justify-center">${segmented([['login', 'Đăng nhập'], ['register', 'Đăng ký']], tab, 'tab')}</div>
              <form id="auth-form" class="space-y-4 mt-6" novalidate>
                ${reg ? field('Họ và tên *', `<input name="name" required autocomplete="name" class="${inputCls}">`) : ''}
                ${reg ? field('Tên hiển thị', `<input name="displayName" class="${inputCls}" placeholder="Mặc định dùng họ tên">`) : ''}
                ${field('Email *', `<input name="email" type="email" required autocomplete="email" value="${esc(lastEmail)}" class="${inputCls}">`)}
                ${field('Mật khẩu *', `<input name="password" type="password" required autocomplete="${reg ? 'new-password' : 'current-password'}" class="${inputCls}">`, reg ? 'Tối thiểu 6 ký tự' : '')}
                ${reg ? field('Nhập lại mật khẩu *', `<input name="confirm" type="password" autocomplete="new-password" class="${inputCls}">`) : ''}
                <div id="auth-error"></div>
                ${button(reg ? 'Tạo tài khoản' : 'Đăng nhập', { type: 'submit', icon: reg ? 'person_add' : 'login', cls: 'w-full', attrs: 'id="auth-submit"' })}
              </form>
            </section>
            <p class="text-center text-xs text-slate-400 mt-4">Phiên đăng nhập (JWT) có hiệu lực 7 ngày.</p>
          </div>
        </div>`;
      root.querySelector(reg ? '[name=name]' : (lastEmail ? '[name=password]' : '[name=email]'))?.focus();
    };

    const showError = (msg) => { root.querySelector('#auth-error').innerHTML = msg ? errorBlock(msg) : ''; };

    const validate = (v) => {
      if (tab === 'register' && !v.name) return 'Vui lòng nhập họ tên';
      if (!/^\S+@\S+\.\S+$/.test(v.email)) return 'Email không hợp lệ';
      if (!v.password) return 'Vui lòng nhập mật khẩu';
      if (tab === 'register' && v.password.length < 6) return 'Mật khẩu tối thiểu 6 ký tự';
      if (tab === 'register' && v.password !== v.confirm) return 'Mật khẩu nhập lại không khớp';
      return '';
    };

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="tab"]');
      if (b) { tab = b.dataset.val; paint(); }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const err = validate(v);
      showError(err);
      if (err) return;
      lastEmail = v.email;
      await busy(root.querySelector('#auth-submit'), async () => {
        try {
          if (tab === 'register') {
            await register({ name: v.name, email: v.email, password: v.password, displayName: v.displayName || v.name });
            toast('Đăng ký thành công', 'emerald');
          }
          await login(v.email, v.password);
        } catch (ex) {
          if (root.isConnected) showError(ex.status === 401 ? 'Email hoặc mật khẩu không đúng' : ex.message);
        }
      });
    });

    paint();
  },
};
