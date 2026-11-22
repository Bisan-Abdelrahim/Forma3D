import { brand } from '../components/Shell.js';
import { modelArt } from '../components/ProjectCards.js';
import { safeRedirect, validateAuth } from '../services/AuthService.js';

export function mountAuth({ root, services, signal, url, router }) {
  const register = url.pathname.replace(/\/$/,'') === '/register';
  const fields = register ? [['username','Username','text','your_username','username'],['fullName','Full name','text','Your full name','name'],['email','Email address','email','you@example.com','email'],['password','Password','password','At least 8 characters','new-password'],['confirmPassword','Confirm password','password','Repeat your password','new-password']]
    : [['email','Email address','email','you@example.com','email'],['password','Password','password','Your password','current-password']];
  root.innerHTML = `<main class="p-auth-layout"><section class="p-auth-story">${brand}<div><p class="p-eyebrow">A SPACE FOR YOUR IMAGINATION</p><h2>Your ideas.<br>In a whole<br><span>new dimension.</span></h2><p>Create, experiment and shape something that’s entirely your own.</p>${modelArt('orbit')}</div><a href="/" data-route>← Back to home</a></section><section class="p-auth-form"><div class="p-auth-top"><a href="/" data-route>← Home</a><span>${register?'Already have an account?':'New to Forma3D?'} <a href="${register?'/login':'/register'}" data-route>${register?'Log in':'Sign up'}</a></span></div><div class="p-auth-content"><span class="p-eyebrow">${register?'LET’S MAKE SOMETHING':'WELCOME BACK'}</span><h1>${register?'Start your creative journey.':'Back to your ideas.'}</h1><p class="p-subtle">${register?'Your future workspace for creating in three dimensions.':'A space for everything you want to create.'}</p><div class="p-inline-notice">Sign in securely through Supabase Auth. Confirm your email after registration if requested.</div><form id="auth-form" novalidate>${fields.map(([name,label,type,placeholder,autocomplete])=>`<div class="p-form-field"><label for="auth-${name}">${label}</label><div class="p-password-field"><input id="auth-${name}" name="${name}" type="${type}" placeholder="${placeholder}" autocomplete="${autocomplete}" required ${type==='password'?'minlength="8"':''} aria-describedby="error-${name}">${type==='password'?`<button type="button" data-password="auth-${name}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">Show</button>`:''}</div><span id="error-${name}" class="p-field-error"></span></div>`).join('')}<button type="submit" class="p-button p-primary p-wide">${register?'Create account':'Sign in'} <span>↗</span></button><p id="auth-status" role="status" aria-live="polite"></p></form><div class="p-auth-divider"><span></span>OR EXPLORE FIRST<span></span></div><a href="/editor/demo" data-route class="p-button p-secondary p-wide">Try the editor without an account ↗</a><p class="p-auth-footnote">Your password is handled by Supabase Auth, never stored in a Forma3D table.</p></div></section></main>`;
  services.auth.getSession().then(async session=>{
    if(!session||signal.aborted)return;
    await services.auth.completeProfile(session.user);
    if(!signal.aborted)await router.navigate(safeRedirect(url.searchParams.get('next')));
  }).catch(error=>{if(!signal.aborted)root.querySelector('#auth-status').textContent=error.message;});
  const form = root.querySelector('#auth-form');
  form.addEventListener('click', event => {
    const toggle = event.target.closest('[data-password]');
    if (!toggle) return;
    const input = root.querySelector(`#${toggle.dataset.password}`), show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed',String(show));
    toggle.setAttribute('aria-label',`${show?'Hide':'Show'} ${input.name === 'confirmPassword'?'confirm password':'password'}`);
  }, { signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const errors = validateAuth(values,register?'register':'login');
    root.querySelector('#auth-status').textContent = '';
    for (const [name] of fields) {
      root.querySelector(`#error-${name}`).textContent = errors[name] ?? '';
      form.elements[name].setAttribute('aria-invalid',String(!!errors[name]));
    }
    if (Object.keys(errors).length) { form.elements[Object.keys(errors)[0]].focus(); return; }
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try {
      const result=await services.auth[register?'register':'login'](values);
      if(signal.aborted)return;
      if(register&&!result.session){root.querySelector('#auth-status').textContent='Check your email to confirm your account, then sign in. No authenticated session is active yet.';form.reset();}
      else await router.navigate(safeRedirect(url.searchParams.get('next')));
    }
    catch(error) { if (!signal.aborted) root.querySelector('#auth-status').textContent = error.message; }
    finally { if (!signal.aborted) submit.disabled = false; }
  }, { signal });
}
