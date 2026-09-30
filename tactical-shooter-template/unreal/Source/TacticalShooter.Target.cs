using UnrealBuildTool;

public class TacticalShooterTarget : TargetRules
{
	public TacticalShooterTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("TacticalShooter");
	}
}
