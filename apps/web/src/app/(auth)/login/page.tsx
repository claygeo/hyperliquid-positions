'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/discover`,
      },
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Check your email for the login link!');
    }
    setLoading(false);
  };

  return (
    <Card className="p-6">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold">Hyperliquid Tracker</h1>
        <p className="text-muted-foreground mt-2">
          Sign in to track smart money wallets
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Sending...' : 'Send Magic Link'}
        </Button>

        {message && (
          <p className="text-sm text-center text-muted-foreground">{message}</p>
        )}
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        <p>Or continue without an account to browse</p>
        <a href="/discover" className="text-primary hover:underline">
          Browse wallets →
        </a>
      </div>
    </Card>
  );
}
