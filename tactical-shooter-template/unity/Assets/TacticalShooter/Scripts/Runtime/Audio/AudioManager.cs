using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Plays the cues in shared/config/audio.json. Every cue is synthesised at startup
    /// (Core.Synth, GAME_RULES.md section 14). To use a real sound, put an AudioClip at
    /// Resources/TacticalShooter/Audio/&lt;cueId&gt; and it replaces the synthesised one.
    /// </summary>
    public sealed class AudioManager : MonoBehaviour
    {
        const int PoolSize = 32;
        readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        readonly Dictionary<string, AudioCue> cues = new Dictionary<string, AudioCue>();
        readonly List<AudioSource> pool = new List<AudioSource>();
        AudioSource uiSource;
        int next;

        public void Init(GameData data)
        {
            int rate = Mathf.Max(8000, data.Audio.sampleRate);
            foreach (var cue in data.Audio.cues)
            {
                cues[cue.id] = cue;
                var clip = Resources.Load<AudioClip>("TacticalShooter/Audio/" + cue.id);
                if (clip == null)
                {
                    float[] samples = Synth.Generate(cue, rate);
                    if (samples.Length == 0) continue;
                    clip = AudioClip.Create(cue.id, samples.Length, 1, rate, false);
                    clip.SetData(samples, 0);
                }
                clips[cue.id] = clip;
            }
            for (int i = 0; i < PoolSize; i++)
            {
                var go = new GameObject("Voice" + i);
                go.transform.SetParent(transform, false);
                var src = go.AddComponent<AudioSource>();
                src.playOnAwake = false;
                src.spatialBlend = 1f;
                src.rolloffMode = AudioRolloffMode.Linear;
                src.dopplerLevel = 0f;
                pool.Add(src);
            }
            uiSource = gameObject.AddComponent<AudioSource>();
            uiSource.playOnAwake = false;
            uiSource.spatialBlend = 0f;
        }

        /// <summary>Plays a cue at a world position (or 2D if the cue is not spatial).</summary>
        public void Play(string cueId, Vector3 position, float volume = 1f)
        {
            if (string.IsNullOrEmpty(cueId) || !clips.TryGetValue(cueId, out var clip)) return;
            var cue = cues[cueId];
            if (!cue.spatial) { Play2D(cueId, volume); return; }
            var listener = Game.Camera != null ? Game.Camera.transform.position : Vector3.zero;
            if ((position - listener).sqrMagnitude > cue.range * cue.range) return;
            var src = pool[next];
            next = (next + 1) % pool.Count;
            src.transform.position = position;
            src.maxDistance = cue.range;
            src.minDistance = Mathf.Min(2f, cue.range * 0.1f);
            src.clip = clip;
            src.volume = Mathf.Clamp01(volume);
            src.pitch = 1f;
            src.Play();
        }

        public void Play2D(string cueId, float volume = 1f)
        {
            if (string.IsNullOrEmpty(cueId) || !clips.TryGetValue(cueId, out var clip)) return;
            uiSource.PlayOneShot(clip, Mathf.Clamp01(volume));
        }
    }
}
