import { createClient } from '@/lib/supabase/client';

export interface UserSettings {
  user_id: string;
  watchlist: string[];
  alert_min_score: number;
  alert_coins: string[] | null;
  auto_copy_enabled: boolean;
  copy_percentage: number;
  max_position_size: number;
  telegram_chat_id: string | null;
  discord_webhook: string | null;
  created_at: string;
  updated_at: string;
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<UserSettings> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: userId,
      ...settings,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAlertSettings(
  userId: string,
  settings: {
    alert_min_score?: number;
    alert_coins?: string[] | null;
    telegram_chat_id?: string | null;
    discord_webhook?: string | null;
  }
): Promise<UserSettings> {
  return updateUserSettings(userId, settings);
}

export async function updateCopyTradingSettings(
  userId: string,
  settings: {
    auto_copy_enabled?: boolean;
    copy_percentage?: number;
    max_position_size?: number;
  }
): Promise<UserSettings> {
  return updateUserSettings(userId, settings);
}

export async function clearWatchlist(userId: string): Promise<void> {
  const supabase = createClient();

  // Clear watchlist table entries
  const { error: watchlistError } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId);

  if (watchlistError) throw watchlistError;

  // Update user settings
  const { error: settingsError } = await supabase
    .from('user_settings')
    .update({ watchlist: [], updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (settingsError) throw settingsError;
}
