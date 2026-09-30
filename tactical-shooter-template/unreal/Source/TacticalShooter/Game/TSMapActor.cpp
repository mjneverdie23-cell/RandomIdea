#include "Game/TSMapActor.h"
#include "TacticalShooter.h"
#include "Game/TSGameSubsystem.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/World.h"

ATSMapActor::ATSMapActor()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Movable);
}

void ATSMapActor::EndPlay(const EEndPlayReason::Type Reason)
{
	// Only when the map is rebuilt; at level teardown the world removes everything anyway.
	if (Reason == EEndPlayReason::Destroyed)
		for (AActor* A : LightingActors)
			if (IsValid(A)) A->Destroy();
	LightingActors.Reset();
	Super::EndPlay(Reason);
}

UInstancedStaticMeshComponent* ATSMapActor::NewInstances(FName Name, const FLinearColor& Color, bool bCollision)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this, Name);
	C->SetupAttachment(RootComponent);
	C->SetMobility(EComponentMobility::Movable);
	C->SetStaticMesh(Game->Mesh(ETSShape::Cube));
	C->SetMaterial(0, Game->Material(Color));
	C->SetCollisionEnabled(bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
	C->SetCollisionObjectType(ECC_WorldStatic);
	C->SetCollisionResponseToAllChannels(ECR_Block);
	C->SetGenerateOverlapEvents(false);
	C->RegisterComponent();
	AddInstanceComponent(C);
	return C;
}

void ATSMapActor::AddBoxes(const FTSMapGrid& Grid, ETSCellType Type, float HeightMetres, float InsetMetres, const FLinearColor& Color, bool bCollision, float BaseMetres)
{
	const TArray<FTSGridBox> Boxes = Grid.Boxes(Type);
	if (Boxes.Num() == 0) return;
	UInstancedStaticMeshComponent* Instances = NewInstances(NAME_None, Color, bCollision);
	const float Cs = Grid.CellSize;
	for (const FTSGridBox& B : Boxes)
	{
		const float East = ((float)B.X + (float)B.W / 2.f - (float)Grid.Width / 2.f) * Cs;
		const float North = ((float)Grid.Height / 2.f - (float)B.Y - (float)B.H / 2.f) * Cs;
		// The engine cube is 1 m, so the scale is the size in metres. Unreal X = north, Y = east.
		const FVector Scale(B.H * Cs - 2.f * InsetMetres, B.W * Cs - 2.f * InsetMetres, HeightMetres);
		const FVector Location(North * 100.f, East * 100.f, (BaseMetres + HeightMetres / 2.f) * 100.f);
		Instances->AddInstance(FTransform(FRotator::ZeroRotator, Location, Scale));
	}
}

FTSWorldMap ATSMapActor::Build(const FTSMapDef& Def)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSVisualSettings& V = Game->Data().Game.Visuals;
	FTSWorldMap World;
	TArray<FString> Errors;
	World.Grid = FTSMapGrid::Parse(Def, Errors);
	for (const FString& E : Errors) UE_LOG(LogTacticalShooter, Warning, TEXT("map '%s': %s"), *Def.Id, *E);
	if (!World.Grid.IsValid()) return World;
	World.Nav = FTSNavGrid(World.Grid);
	const FTSMapGrid& G = World.Grid;

	// Floor slab: top surface at Z = 0.
	UInstancedStaticMeshComponent* Floor = NewInstances(TEXT("Floor"), UTSGameSubsystem::Color(V.FloorColor), true);
	Floor->AddInstance(FTransform(FRotator::ZeroRotator, FVector(0.f, 0.f, -25.f), FVector(G.WorldHeight(), G.WorldWidth(), 0.5f)));

	AddBoxes(G, ETSCellType::Wall, Def.WallHeight, 0.f, UTSGameSubsystem::Color(V.WallColor), true);
	AddBoxes(G, ETSCellType::HighCover, Def.HighCoverHeight, 0.1f, UTSGameSubsystem::Color(V.HighCoverColor), true);
	AddBoxes(G, ETSCellType::LowCover, Def.LowCoverHeight, 0.15f, UTSGameSubsystem::Color(V.LowCoverColor), true);
	AddBoxes(G, ETSCellType::SiteA, 0.02f, 0.f, UTSGameSubsystem::Color(V.SiteColor), false);
	AddBoxes(G, ETSCellType::SiteB, 0.02f, 0.f, UTSGameSubsystem::Color(V.SiteColor), false);
	AddBoxes(G, ETSCellType::AttackSpawn, 0.02f, 0.f, UTSGameSubsystem::Color(V.AttackSpawnColor), false);
	AddBoxes(G, ETSCellType::DefenseSpawn, 0.02f, 0.f, UTSGameSubsystem::Color(V.DefenseSpawnColor), false);

	for (int32 Site = 0; Site < 2; ++Site)
	{
		if (!World.HasSite(Site)) continue;
		const FVector C = World.SiteCenter(Site);
		Game->AddShape(this, RootComponent, ETSShape::Cylinder, C + FVector(0.f, 0.f, 200.f), FVector(0.12f, 0.12f, 4.f), FLinearColor::Gray);
		Game->AddShape(this, RootComponent, ETSShape::Cube, C + FVector(0.f, 45.f, 360.f), FVector(0.05f, 0.8f, 0.5f), UTSGameSubsystem::Color(V.SiteColor));
	}
	SpawnLighting();
	return World;
}

void ATSMapActor::SpawnLighting()
{
	UWorld* W = GetWorld();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	ADirectionalLight* Sun = W->SpawnActor<ADirectionalLight>(FVector(0.f, 0.f, 2000.f), FRotator(-52.f, -35.f, 0.f), Params);
	if (Sun != nullptr)
	{
		LightingActors.Add(Sun);
		Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
		if (UDirectionalLightComponent* Light = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			Light->SetAtmosphereSunLight(true);
			Light->SetIntensity(8.f);
		}
	}

	// Sky atmosphere (loaded by class name so no extra module or header is needed).
	if (UClass* AtmosphereClass = LoadClass<AActor>(nullptr, TEXT("/Script/Engine.SkyAtmosphere")))
		LightingActors.Add(W->SpawnActor<AActor>(AtmosphereClass, FTransform::Identity, Params));

	ASkyLight* Sky = W->SpawnActor<ASkyLight>(FVector(0.f, 0.f, 500.f), FRotator::ZeroRotator, Params);
	if (Sky != nullptr)
	{
		LightingActors.Add(Sky);
		USkyLightComponent* SkyLight = Sky->GetLightComponent();
		SkyLight->SetMobility(EComponentMobility::Movable);
		SkyLight->bRealTimeCapture = true;
		SkyLight->SetIntensity(1.f);
		SkyLight->MarkRenderStateDirty();
		SkyLight->RecaptureSky();
	}
}
