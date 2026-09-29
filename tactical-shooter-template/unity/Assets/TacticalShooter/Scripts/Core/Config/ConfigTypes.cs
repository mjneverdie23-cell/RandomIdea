using System;

// Plain data classes that mirror shared/config/*.json field for field. Initialiser values are
// the documented defaults, used when a field is missing from the JSON. Unreal mirrors these as
// USTRUCTs in Source/TacticalShooter/Core/TSConfigTypes.h.
namespace TacticalShooter.Core
{
    [Serializable]
    public sealed class MatchSettings
    {
        public int roundsToWin = 13;
        public int halftimeAfterRound = 12;
        public bool overtimeEnabled = true;
        public int overtimeWinMargin = 2;
        public int overtimeStartMoney = 5000;
        public int overtimeSwapEveryRounds = 1;
        public int maxOvertimeRounds = 12;
        public int teamSize = 5;
        public float firstRoundExtraBuySeconds = 5f;
        public float halftimeSeconds = 5f;
    }

    [Serializable]
    public sealed class RoundSettings
    {
        public float buyPhaseSeconds = 20f;
        public float roundSeconds = 100f;
        public float roundEndSeconds = 6f;
        public bool freezeDuringBuyPhase = true;
        public bool buyOnlyInSpawnZone = true;
        public float buyGraceSeconds = 15f;
    }

    [Serializable]
    public sealed class EconomySettings
    {
        public int startMoney = 800;
        public int maxMoney = 9000;
        public int winReward = 3000;
        public int lossBase = 1900;
        public int lossStreakIncrement = 500;
        public int lossMax = 2900;
        public int plantRewardTeam = 300;
        public int plantRewardPlayer = 300;
        public int defuseRewardPlayer = 300;
        public int defaultKillReward = 200;
        public bool sellBackDuringBuyPhase = true;
    }

    [Serializable]
    public sealed class BombSettings
    {
        public float plantSeconds = 4f;
        public float defuseSeconds = 7f;
        public float defuseKitSeconds = 4f;
        public bool halfDefuseCheckpoint = true;
        public float fuseSeconds = 45f;
        public float blastRadius = 16f;
        public int blastDamage = 500;
        public float interactRadius = 1.6f;
        public float pickupRadius = 1.2f;
        public float beepIntervalStart = 1f;
        public float beepIntervalEnd = 0.15f;
    }

    [Serializable]
    public sealed class MovementSettings
    {
        public float runSpeed = 6f;
        public float walkMultiplier = 0.55f;
        public float crouchMultiplier = 0.4f;
        public float acceleration = 45f;
        public float deceleration = 40f;
        public float airAcceleration = 8f;
        public float gravity = 20f;
        public float jumpVelocity = 7.4f;
        public float standHeight = 1.8f;
        public float crouchHeight = 1.2f;
        public float radius = 0.35f;
        public float eyeHeightStand = 1.62f;
        public float eyeHeightCrouch = 1.05f;
        public float crouchTransitionSpeed = 8f;
        public float stepHeight = 0.35f;
    }

    [Serializable]
    public sealed class CombatSettings
    {
        public int maxHealth = 100;
        public int maxArmor = 50;
        public bool friendlyFire = false;
        public float armorAbsorption = 1f;
        public float headZoneFraction = 0.84f;
        public float legZoneFraction = 0.42f;
        public int assistMinDamage = 40;
        public float abilityCooldownSeconds = 0.5f;
        public float projectileGravity = 15f;
        public float projectileBounce = 0.4f;
    }

    [Serializable]
    public sealed class UltimateSettings
    {
        public int pointsPerKill = 1;
        public int pointsPerDeath = 1;
        public int pointsPerPlant = 1;
        public int pointsPerDefuse = 1;
    }

    [Serializable]
    public sealed class ScoringSettings
    {
        public int kill = 2;
        public int assist = 1;
        public int plant = 2;
        public int defuse = 2;
    }

    [Serializable]
    public sealed class LoadoutSettings
    {
        public string defaultMelee = "knife";
        public string defaultSecondary = "p9";
    }

    [Serializable]
    public sealed class VisualSettings
    {
        public string attackColor = "#E0533D";
        public string defenseColor = "#3D8BE0";
        public string floorColor = "#8A8A82";
        public string wallColor = "#C9C3B6";
        public string lowCoverColor = "#9C7A4E";
        public string highCoverColor = "#6E6A63";
        public string siteColor = "#D9B44A";
        public string attackSpawnColor = "#7A4A42";
        public string defenseSpawnColor = "#42587A";
        public string skinColor = "#E0B89A";
        public string bombColor = "#FF2D2D";
        public string skyColor = "#9FC3E7";
    }

    /// <summary>shared/config/game.json</summary>
    [Serializable]
    public sealed class GameConfig
    {
        public MatchSettings match = new MatchSettings();
        public RoundSettings round = new RoundSettings();
        public EconomySettings economy = new EconomySettings();
        public BombSettings bomb = new BombSettings();
        public MovementSettings movement = new MovementSettings();
        public CombatSettings combat = new CombatSettings();
        public UltimateSettings ultimate = new UltimateSettings();
        public ScoringSettings scoring = new ScoringSettings();
        public LoadoutSettings loadout = new LoadoutSettings();
        public VisualSettings visuals = new VisualSettings();
        public string[] mapRotation = { "outpost" };
    }

    [Serializable]
    public sealed class RecoilStep
    {
        public float pitch;
        public float yaw;
    }

    /// <summary>One entry of shared/config/weapons.json</summary>
    [Serializable]
    public sealed class WeaponDef
    {
        public string id = "";
        public string displayName = "";
        public string category = "sidearm";
        public string slot = "secondary";
        public int price;
        public int killReward = -1;
        public float damage = 20f;
        public float headMultiplier = 4f;
        public float legMultiplier = 0.85f;
        public float armorPenetration;
        public float falloffStart;
        public float falloffEnd;
        public float falloffMinMultiplier = 1f;
        public float maxRange = 200f;
        public string fireMode = "semi";
        public float fireRate = 5f;
        public int magazineSize = 10;
        public int reserveAmmo = 30;
        public float reloadSeconds = 2f;
        public float equipSeconds = 0.75f;
        public int pellets = 1;
        public float baseSpread = 0.3f;
        public float moveSpread = 4f;
        public float airSpread = 8f;
        public float crouchSpreadMultiplier = 0.85f;
        public float adsSpreadMultiplier = 1f;
        public float bloomPerShot = 0.3f;
        public float maxBloom = 3f;
        public RecoilStep[] recoilPattern = new RecoilStep[0];
        public float recoilRandomYaw;
        public float recoilRecovery = 15f;
        public float recoilResetSeconds = 0.35f;
        public float adsFovMultiplier = 1f;
        public bool scoped;
        public float adsMoveMultiplier = 1f;
        public float moveSpeedMultiplier = 1f;
        public string fireSound = "shot_rifle";
        public string color = "#333333";

        public WeaponSlot Slot => Ids.ParseSlot(slot);
        public FireMode Mode => Ids.ParseFireMode(fireMode);
        public WeaponCategory Category => Ids.ParseCategory(category);
        public bool HasAds => adsFovMultiplier < 0.999f || scoped;
    }

    [Serializable]
    public sealed class WeaponList { public WeaponDef[] weapons = new WeaponDef[0]; }

    /// <summary>One entry of shared/config/equipment.json. type: "armor" or "defuseKit".</summary>
    [Serializable]
    public sealed class EquipmentDef
    {
        public string id = "";
        public string displayName = "";
        public string type = "armor";
        public int price;
        public int amount;
        public string side = "any";
        public string description = "";
    }

    [Serializable]
    public sealed class EquipmentList { public EquipmentDef[] equipment = new EquipmentDef[0]; }

    /// <summary>One entry of shared/config/abilities.json. Which fields matter depends on type.</summary>
    [Serializable]
    public sealed class AbilityDef
    {
        public string id = "";
        public string displayName = "";
        public string type = "buff";
        public string description = "";
        public float throwSpeed = 16f;
        public float fuseSeconds = 1.5f;
        public float radius = 4f;
        public float duration = 5f;
        public float damage;
        public float amount;
        public float distance = 5f;
        public float width = 6f;
        public float height = 3f;
        public float speedMultiplier = 1f;
        public float fireRateMultiplier = 1f;
        public float damageTakenMultiplier = 1f;
        public string color = "#FFFFFF";

        public AbilityType Type { get { Ids.TryParseAbilityType(type, out var t); return t; } }
        public bool IsThrown { get { var t = Type; return t == AbilityType.Flash || t == AbilityType.Smoke || t == AbilityType.Frag || t == AbilityType.Incendiary; } }
    }

    [Serializable]
    public sealed class AbilityList { public AbilityDef[] abilities = new AbilityDef[0]; }

    [Serializable]
    public sealed class AgentAbilitySlot
    {
        public string slot = "C";
        public string abilityId = "";
        public int price;
        public int maxCharges = 1;
        public int freeChargesPerRound;
        public int ultPoints;

        public bool IsUltimate => ultPoints > 0;
        public bool IsPurchasable => !IsUltimate && price > 0;
    }

    /// <summary>One entry of shared/config/agents.json. Always four ability slots: C, Q, E, X.</summary>
    [Serializable]
    public sealed class AgentDef
    {
        public string id = "";
        public string displayName = "";
        public string role = "";
        public string color = "#FFFFFF";
        public string description = "";
        public AgentAbilitySlot[] abilities = new AgentAbilitySlot[0];
    }

    [Serializable]
    public sealed class AgentList { public AgentDef[] agents = new AgentDef[0]; }

    [Serializable]
    public sealed class BotDifficulty
    {
        public string id = "normal";
        public string displayName = "Normal";
        public float reactionTime = 0.35f;
        public float aimErrorDegrees = 2.5f;
        public float turnSpeed = 400f;
        public float viewAngle = 110f;
        public float sightRange = 60f;
        public int burstShots = 4;
        public float burstPause = 0.3f;
        public float headshotBias = 0.3f;
        public float recoilControl = 0.5f;
        public float abilityUseChance = 0.4f;
    }

    [Serializable]
    public sealed class BotBuySettings
    {
        public int fullBuyMoney = 3900;
        public int forceBuyMoney = 2000;
        public float sniperChance = 0.2f;
        public string[] preferredRifles = new string[0];
        public string[] forceBuyWeapons = new string[0];
        public float abilityBuyChance = 0.8f;
    }

    [Serializable]
    public sealed class BotBehaviourSettings
    {
        public float perceptionInterval = 0.1f;
        public float repathSeconds = 1.5f;
        public float stuckSeconds = 1.2f;
        public float memorySeconds = 3f;
        public int holdRadiusCells = 5;
        public float midRouteChance = 0.35f;
        public float decisionJitterSeconds = 1.5f;
    }

    /// <summary>shared/config/bots.json</summary>
    [Serializable]
    public sealed class BotConfig
    {
        public string defaultDifficulty = "normal";
        public BotDifficulty[] difficulties = new BotDifficulty[0];
        public string[] names = new string[0];
        public BotBuySettings buy = new BotBuySettings();
        public BotBehaviourSettings behaviour = new BotBehaviourSettings();
    }

    [Serializable]
    public sealed class KeyBinding
    {
        public string action = "";
        public string key = "";
        public string altKey = "";
    }

    /// <summary>shared/config/input.json. Key names are engine-neutral; see KeyNames.</summary>
    [Serializable]
    public sealed class InputConfig { public KeyBinding[] bindings = new KeyBinding[0]; }

    [Serializable]
    public sealed class AudioCue
    {
        public string id = "";
        public string wave = "sine";
        public float frequency = 440f;
        public float frequencyEnd;
        public float duration = 0.1f;
        public float attack = 0.003f;
        public float decay = 2f;
        public float volume = 0.5f;
        public float noise;
        public float range = 50f;
        public bool spatial = true;
    }

    /// <summary>shared/config/audio.json</summary>
    [Serializable]
    public sealed class AudioConfig
    {
        public int sampleRate = 22050;
        public AudioCue[] cues = new AudioCue[0];
    }

    /// <summary>shared/maps/*.json</summary>
    [Serializable]
    public sealed class MapDef
    {
        public string id = "";
        public string displayName = "";
        public string description = "";
        public float cellSize = 2f;
        public float wallHeight = 4f;
        public float lowCoverHeight = 1.1f;
        public float highCoverHeight = 2.4f;
        public string[] legend = new string[0];
        public string[] rows = new string[0];
    }

    /// <summary>
    /// Player preferences. Defaults come from shared/config/settings.json; the player's copy is
    /// saved per machine by each engine (Unity: persistentDataPath, Unreal: Saved/).
    /// </summary>
    [Serializable]
    public sealed class UserSettings
    {
        public string playerName = "You";
        public float mouseSensitivity = 0.5f;
        public float adsSensitivityMultiplier = 1f;
        public bool invertY;
        public float fieldOfView = 103f;
        public float masterVolume = 0.8f;
        public bool fullscreen = true;
        public bool vsync = true;
        public int qualityLevel = -1;
        public int fpsLimit;
        public bool showFps = true;
        public string crosshairColor = "#00FF7F";
        public float crosshairSize = 6f;
        public float crosshairGap = 3f;
        public float crosshairThickness = 2f;
        public bool crosshairDot;
        public bool crosshairDynamic = true;
        public string mapId = "outpost";
        public string agentId = "vanguard";
        public string playerSide = "attack";
        public string botDifficulty = "normal";
        public int teamSize = 5;
        public int roundsToWin = 13;
        public KeyBinding[] keyOverrides = new KeyBinding[0];

        public UserSettings Clone() => Json.JsonMapper.FromJson<UserSettings>(Json.JsonMapper.ToJson(this, false));
    }
}
