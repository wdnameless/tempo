import { AISettings, AlarmItem } from '../types';
import { AICompilerService } from './aiCompiler';

export class AIService {
  /**
   * Generates one or more alarms from a natural-language instruction.
   * E.g. "Поставь будильник на пробежку в 7:00 и на витамины в 14:00"
   *
   * Unified with AICompilerService (R12) — avoids duplicate pipeline.
   */
  static async generateAlarms(
    prompt: string,
    settings: AISettings,
  ): Promise<{ alarms: AlarmItem[]; error: string | null }> {
    try {
      const plan = await AICompilerService.compileIntent(prompt, settings);
      if (plan.action === 'create_alarms' && plan.alarms && plan.alarms.length > 0) {
        const alarms: AlarmItem[] = plan.alarms.map((a, idx) => ({
          id: `alarm_${Date.now()}_${idx}`,
          title: a.label,
          label: a.label,
          time: a.time,
          repeat: (a.repeat === 'date' || a.repeat === 'interval' ? 'once' : a.repeat) as AlarmItem['repeat'],
          days: a.days || [],
          enabled: true,
          sound: 'gentle',
        }));
        return { alarms, error: null };
      }
      if (plan.action === 'noop' && plan.explanation) {
        return { alarms: [], error: plan.explanation };
      }
      return { alarms: [], error: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { alarms: [], error: msg };
    }
  }
}
