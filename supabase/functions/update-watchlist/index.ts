// Supabase Edge Function: Update Watchlist

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  action: 'add' | 'remove';
  wallet_address: string;
  user_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, wallet_address, user_id } = await req.json() as RequestBody;

    if (!action || !wallet_address || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get current user settings
    const { data: settings, error: fetchError } = await supabase
      .from('user_settings')
      .select('watchlist')
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    let watchlist = settings?.watchlist || [];

    if (action === 'add') {
      if (!watchlist.includes(wallet_address)) {
        watchlist.push(wallet_address);
      }
    } else if (action === 'remove') {
      watchlist = watchlist.filter((w: string) => w !== wallet_address);
    }

    // Upsert user settings
    const { error: upsertError } = await supabase
      .from('user_settings')
      .upsert({
        user_id,
        watchlist,
        updated_at: new Date().toISOString(),
      });

    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ success: true, watchlist }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
