import { getSupabaseClient } from './supabaseClient.js';
export function validateAuth(values, mode = 'login') {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email?.trim() ?? '')) errors.email = 'Enter a valid email address.';
  if (!values.password || values.password.length < 8) errors.password = 'Use at least 8 characters.';
  if (mode === 'register') {
    if (!/^[a-zA-Z0-9_]{3,50}$/.test(values.username ?? '')) errors.username = 'Use 3–50 letters, numbers or underscores.';
    if (!values.fullName?.trim() || values.fullName.trim().length < 2 || values.fullName.trim().length > 150) errors.fullName = 'Enter your full name (2–150 characters).';
    if (values.confirmPassword !== values.password) errors.confirmPassword = 'Passwords do not match.';
  }
  return errors;
}
export function safeRedirect(value) {
  return typeof value === 'string' && /^\/(dashboard|projects)(\?|$)/.test(value) || typeof value === 'string' && /^\/editor\/[a-zA-Z0-9-]+$/.test(value) ? value : '/dashboard';
}
export class AuthService {
  constructor({ client, provider = getSupabaseClient } = {}) { this.provider = () => client ?? provider(); }
  async getSession() {
    const { data, error } = await this.provider().auth.getSession();
    if (error) throw error;
    return data.session;
  }
  async getCurrentUser() {
    const session = await this.getSession();
    if (!session) return null;
    const { data, error } = await this.provider().auth.getUser();
    if (error) { if ([401,403].includes(error.status)) return null; throw error; }
    return data.user;
  }
  async requireUser() { const user = await this.getCurrentUser(); if (!user) throw new Error('Please sign in to continue.'); return user; }
  async getProfile() {
    const user = await this.requireUser();
    const { data, error } = await this.provider().from('profiles').select('id,username,full_name,avatar_path').eq('id',user.id).single();
    if (error) throw error;
    return data;
  }
  async completeProfile(user) {
    const client = this.provider();
    const { data, error } = await client.from('profiles').select('id,username').eq('id',user.id).single();
    if (error) throw error;
    // The supplied auth trigger creates profiles and copies full_name, but not username.
    if (!data.username && user.user_metadata?.username) {
      const { error: updateError } = await client.from('profiles').update({ username:user.user_metadata.username }).eq('id',user.id).select('id').single();
      if (updateError) throw new Error(`Signed in, but your profile username could not be updated: ${updateError.message}`);
    }
  }
  async login({email,password}) {
    const { data, error } = await this.provider().auth.signInWithPassword({email:email.trim(),password});
    if (error) throw error;
    await this.completeProfile(data.user);
    return data;
  }
  async register(values) {
    const errors = validateAuth(values,'register');
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    const { data, error } = await this.provider().auth.signUp({email:values.email.trim(),password:values.password,options:{ data:{full_name:values.fullName.trim(),username:values.username}, emailRedirectTo:new URL('/login',location.origin).href }});
    if (error) throw error;
    if (data.session) await this.completeProfile(data.user);
    return data;
  }
  async logout() { const {error} = await this.provider().auth.signOut(); if (error) throw error; }
  onAuthStateChange(callback) {
    try {
      const {data} = this.provider().auth.onAuthStateChange((event,session) => {
        // Do not await other Supabase calls inside its auth lock.
        setTimeout(()=>callback(event,session),0);
      });
      return () => data.subscription.unsubscribe();
    } catch { return () => {}; }
  }
}
