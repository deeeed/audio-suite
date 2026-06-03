import React, { createContext, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { type FarmslotRecipeHudState, RecipeHud, type RecipeHudOptions } from './RecipeHud';

export interface FarmslotRecipeBridgeCommand {
  command: string;
  nodeId: string;
  payload?: Record<string, unknown>;
}

export interface FarmslotRecipeBridgeApi {
  handleCommand(command: FarmslotRecipeBridgeCommand): Promise<unknown>;
}

export interface RecipeBridgeProviderOptions {
  bridgeName?: string;
  hud?: RecipeHudOptions;
  isEnabled?: () => boolean;
  renderHud?: (state: FarmslotRecipeHudState | null) => React.ReactNode;
}

declare global {
  var __FARMSLOT_RECIPE_BRIDGE__: FarmslotRecipeBridgeApi | undefined;
}

export const FarmslotRecipeBridgeContext = createContext<FarmslotRecipeBridgeApi | null>(null);

interface RecipeBridgeProviderProps extends RecipeBridgeProviderOptions {
  children: React.ReactNode;
}

export function RecipeBridgeProvider({
  bridgeName = '@farmslot/expo-recipe',
  children,
  hud: hudOptions,
  isEnabled = isRecipeBridgeEnabled,
  renderHud,
}: Readonly<RecipeBridgeProviderProps>): React.ReactElement {
  const enabled = isEnabled();
  const [hud, setHud] = useState<FarmslotRecipeHudState | null>(null);

  const bridge = useMemo<FarmslotRecipeBridgeApi>(
    () => ({
      async handleCommand(command) {
        if (!enabled) {
          return { ok: false, error: 'Farmslot recipe bridge is disabled.' };
        }
        if (command.command === 'status') {
          return { ok: true, bridge: bridgeName, platform: Platform.OS, hud: true };
        }
        if (command.command === 'hud') {
          setHud(normalizeHudState(command.payload));
          return { ok: true };
        }
        if (command.command === 'trace') {
          return { ok: true, trace: command.payload ?? {} };
        }
        return { ok: false, error: `Unsupported Farmslot bridge command: ${command.command}` };
      },
    }),
    [bridgeName, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    globalThis.__FARMSLOT_RECIPE_BRIDGE__ = bridge;
    return () => {
      if (globalThis.__FARMSLOT_RECIPE_BRIDGE__ === bridge) {
        globalThis.__FARMSLOT_RECIPE_BRIDGE__ = undefined;
      }
    };
  }, [bridge, enabled]);

  if (!enabled) return <>{children}</>;

  return (
    <FarmslotRecipeBridgeContext.Provider value={bridge}>
      <View style={{ flex: 1 }}>
        {children}
        {renderHud ? renderHud(hud) : <RecipeHud state={hud} {...hudOptions} />}
      </View>
    </FarmslotRecipeBridgeContext.Provider>
  );
}

function isRecipeBridgeEnabled(): boolean {
  return Boolean(__DEV__ && process.env.EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE === '1');
}

function normalizeHudState(payload: Record<string, unknown> | undefined): FarmslotRecipeHudState {
  const status = parseStatus(payload?.status);
  const progress = isRecord(payload?.progress) ? payload.progress : undefined;
  return {
    status,
    intent: asString(
      payload?.intent ?? payload?.text,
      status === 'fail' ? 'Recipe failed' : 'Recipe HUD missing intent',
    ),
    currentStep: asOptionalNumber(
      payload?.currentStep ?? payload?.current_step ?? progress?.current,
    ),
    totalSteps: asOptionalNumber(payload?.totalSteps ?? payload?.total_steps ?? progress?.total),
    error: asOptionalString(payload?.error),
  };
}

function parseStatus(value: unknown): FarmslotRecipeHudState['status'] {
  if (value === 'idle' || value === 'running' || value === 'pass' || value === 'fail') return value;
  return 'running';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
