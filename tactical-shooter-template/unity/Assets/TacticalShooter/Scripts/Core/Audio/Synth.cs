using System;

namespace TacticalShooter.Core
{
    /// <summary>
    /// Placeholder sound generator (GAME_RULES.md section 14). Both engines synthesise every cue
    /// in audio.json with this exact algorithm at startup, so the template ships with sound and
    /// no audio files.
    /// </summary>
    public static class Synth
    {
        public static float[] Generate(AudioCue cue, int sampleRate)
        {
            int n = (int)Math.Floor(cue.duration * sampleRate + 0.5);
            if (n <= 0) return new float[0];
            var samples = new float[n];
            var rng = new Rng(Hash.Fnv1a(cue.id));
            Wave wave = Ids.ParseWave(cue.wave);
            double f0 = cue.frequency, f1 = cue.frequencyEnd;
            double mix = wave == Wave.Noise ? 1.0 : cue.noise;
            double attack = Math.Max(cue.attack, 1e-4);
            double phase = 0.0;
            for (int i = 0; i < n; i++)
            {
                double t = (double)i / sampleRate;
                double u = t / cue.duration;
                double f = (f1 > 0 && f0 > 0) ? f0 * Math.Pow(f1 / f0, u) : f0;
                phase += f / sampleRate;
                phase -= Math.Floor(phase);
                double osc;
                switch (wave)
                {
                    case Wave.Sine: osc = Math.Sin(2.0 * Math.PI * phase); break;
                    case Wave.Square: osc = phase < 0.5 ? 1.0 : -1.0; break;
                    case Wave.Saw: osc = 2.0 * phase - 1.0; break;
                    case Wave.Triangle: osc = 1.0 - 4.0 * Math.Abs(phase - 0.5); break;
                    default: osc = 0.0; break;
                }
                double noise = rng.NextFloat() * 2.0 - 1.0;
                double env = Math.Min(1.0, t / attack) * Math.Pow(Math.Max(0.0, 1.0 - u), cue.decay);
                samples[i] = (float)((osc * (1.0 - mix) + noise * mix) * env * cue.volume);
            }
            return samples;
        }
    }
}
