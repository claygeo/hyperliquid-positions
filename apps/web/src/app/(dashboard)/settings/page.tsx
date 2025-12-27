'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function SettingsPage() {
  const [alertScore, setAlertScore] = useState(60);
  const [telegramId, setTelegramId] = useState('');
  const [discordWebhook, setDiscordWebhook] = useState('');

  const handleSave = async () => {
    // TODO: Save settings to Supabase
    alert('Settings saved!');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your alerts and preferences
        </p>
      </div>

      {/* Alert Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Alert Settings</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Minimum Wallet Score for Alerts
            </label>
            <div className="flex items-center gap-4">
              <Input
                type="range"
                min="0"
                max="100"
                value={alertScore}
                onChange={(e) => setAlertScore(parseInt(e.target.value))}
                className="flex-1"
              />
              <Badge variant="secondary" className="w-12 justify-center">
                {alertScore}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Only receive alerts for wallets with score above this threshold
            </p>
          </div>
        </div>
      </Card>

      {/* Notification Channels */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Notification Channels</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Telegram Chat ID
            </label>
            <Input
              type="text"
              placeholder="Enter your Telegram chat ID"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Get your chat ID from @userinfobot on Telegram
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Discord Webhook URL
            </label>
            <Input
              type="text"
              placeholder="https://discord.com/api/webhooks/..."
              value={discordWebhook}
              onChange={(e) => setDiscordWebhook(e.target.value)}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Create a webhook in your Discord server settings
            </p>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border-destructive/50">
        <h2 className="text-lg font-semibold mb-4 text-destructive">Danger Zone</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Clear Watchlist</p>
              <p className="text-sm text-muted-foreground">
                Remove all wallets from your watchlist
              </p>
            </div>
            <Button variant="destructive" size="sm">
              Clear All
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave}>Save Settings</Button>
      </div>
    </div>
  );
}
