import { getSupabase, hasSupabaseConfig } from "./supabase.js";

export { hasSupabaseConfig as hasAuthConfig };

export async function getSession() {
  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const client = getSupabase();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/account` },
  });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email, password) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email, password, displayName) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${location.origin}/account`,
      data: { display_name: displayName || email.split("@")[0] },
    },
  });
  if (error) throw error;
  return data;
}

export async function updateAccount({ displayName, color }) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.auth.updateUser({
    data: { display_name: displayName, color },
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
