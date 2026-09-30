using UnrealBuildTool;

public class TacticalShooterEditorTarget : TargetRules
{
	public TacticalShooterEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("TacticalShooter");
	}
}
