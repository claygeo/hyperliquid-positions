// Supabase Edge Function: Get Wallet Score

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const address = url.searchParams.get('address');

    if (!address) {
      return new Response(
        JSON.stringify({ error: 'Address is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Get wallet data
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('address', address)
      .single();

    if (walletError) {
      return new Response(
        JSON.stringify({ error: 'Wallet not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get recent positions
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('wallet', address)
      .neq('size', 0);

    // Get recent trades
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('wallet', address)
      .order('timestamp', { ascending: false })
      .limit(100);

    const response = {
      wallet,
      positions: positions || [],
      recentTrades: trades || [],
      score: {
        overall: wallet.overall_score,
        components: {
          entryQuality: wallet.entry_score,
          winRate: wallet.win_rate,
          riskAdjusted: wallet.risk_adjusted_return,
          fundingEfficiency: wallet.funding_efficiency,
        },
        confidence: calculateConfidence(wallet.total_trades),
      },
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateConfidence(tradeCount: number): number {
  const MIN_TRADES = 20;
  const HIGH_CONFIDENCE = 100;
  
  if (tradeCount < MIN_TRADES) return 0;
  if (tradeCount >= HIGH_CONFIDENCE) return 1;
  
  return (tradeCount - MIN_TRADES) / (HIGH_CONFIDENCE - MIN_TRADES);
}
