using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// The one camera: slow orbit over the map in menus, first person through a character's eyes
    /// in game (own or spectated), overview when nobody is left to watch. Also owns the
    /// first-person view model (a box gun) and the ADS zoom.
    /// </summary>
    public sealed class CameraRig : MonoBehaviour
    {
        enum Mode { Menu, Follow, Overview }

        public Camera Cam { get; private set; }
        Mode mode = Mode.Menu;
        TacticalCharacter target;
        WorldMap menuWorld;
        float orbit;
        Transform viewModel;
        GameObject viewGun;
        WeaponDef shownWeapon;
        float kick;
        float bob;

        public static CameraRig Create(Transform parent)
        {
            var cam = Camera.main;
            if (cam == null)
            {
                var go = new GameObject("Main Camera") { tag = "MainCamera" };
                go.transform.SetParent(parent, false);
                cam = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
            }
            cam.nearClipPlane = 0.03f;
            cam.farClipPlane = 500f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            var rig = cam.gameObject.AddComponent<CameraRig>();
            rig.Cam = cam;
            rig.BuildViewModel();
            return rig;
        }

        void BuildViewModel()
        {
            viewModel = new GameObject("ViewModel").transform;
            viewModel.SetParent(transform, false);
            viewModel.localPosition = new Vector3(0.2f, -0.2f, 0.32f);
            viewGun = Prims.Shape(PrimitiveType.Cube, viewModel, Vector3.zero, new Vector3(0.06f, 0.08f, 0.4f), Color.black, "ViewGun");
            Prims.Shape(PrimitiveType.Cube, viewModel, new Vector3(0f, -0.08f, -0.08f), new Vector3(0.05f, 0.12f, 0.06f), new Color(0.15f, 0.15f, 0.15f), "Grip");
            viewModel.gameObject.SetActive(false);
        }

        public void SetMenuTarget(WorldMap world) => menuWorld = world;

        public void MenuMode()
        {
            SetTarget(null);
            mode = Mode.Menu;
        }

        public void Overview()
        {
            SetTarget(null);
            mode = Mode.Overview;
        }

        public bool IsFollowing(TacticalCharacter c) => mode == Mode.Follow && target == c;

        public void Follow(TacticalCharacter c)
        {
            SetTarget(c);
            mode = Mode.Follow;
        }

        void SetTarget(TacticalCharacter c)
        {
            if (target != null && target != c) target.Visual.SetHidden(false);
            target = c;
            if (target != null) target.Visual.SetHidden(true);
        }

        public void Kick() => kick = 1f;

        void LateUpdate()
        {
            var s = Game.Settings;
            float aspect = Cam.aspect;
            switch (mode)
            {
                case Mode.Menu:
                case Mode.Overview:
                {
                    viewModel.gameObject.SetActive(false);
                    float size = menuWorld != null ? Mathf.Max(menuWorld.Grid.WorldWidth, menuWorld.Grid.WorldHeight) : 80f;
                    orbit += Time.unscaledDeltaTime * (mode == Mode.Menu ? 4f : 8f);
                    float r = size * (mode == Mode.Menu ? 0.55f : 0.45f);
                    Vector3 pos = new Vector3(Mathf.Sin(orbit * Mathf.Deg2Rad) * r, size * (mode == Mode.Menu ? 0.45f : 0.7f), Mathf.Cos(orbit * Mathf.Deg2Rad) * r);
                    transform.SetPositionAndRotation(pos, Quaternion.LookRotation(-pos.normalized));
                    Cam.fieldOfView = 55f;
                    break;
                }
                case Mode.Follow:
                {
                    if (target == null) { mode = Mode.Overview; break; }
                    transform.SetPositionAndRotation(target.EyePosition, target.ViewRotation);
                    var w = target.Weapons.CurrentDef;
                    bool aiming = target.Alive && target.Weapons.IsAiming && w != null;
                    float hFov = (s != null ? s.fieldOfView : 103f) * (aiming ? w.adsFovMultiplier : 1f);
                    float vFov = WeaponMath.HorizontalToVerticalFov(hFov, aspect);
                    Cam.fieldOfView = Mathf.Lerp(Cam.fieldOfView, vFov, 1f - Mathf.Exp(-18f * Time.unscaledDeltaTime));
                    UpdateViewModel(w, target.Alive && !(aiming && w.scoped));
                    break;
                }
            }
        }

        void UpdateViewModel(WeaponDef w, bool visible)
        {
            viewModel.gameObject.SetActive(visible && w != null);
            if (!visible || w == null) return;
            if (w != shownWeapon)
            {
                shownWeapon = w;
                Prims.SetColor(viewGun, Prims.ToColor(w.color));
                float length = w.Category == WeaponCategory.Melee ? 0.22f : w.Category == WeaponCategory.Sidearm ? 0.2f
                             : w.Category == WeaponCategory.Sniper ? 0.7f : 0.45f;
                viewGun.transform.localScale = new Vector3(0.06f, 0.08f, length);
                viewGun.transform.localPosition = new Vector3(0f, 0f, length * 0.3f);
            }
            float dt = Time.deltaTime;
            kick = Mathf.MoveTowards(kick, 0f, dt * 8f);
            bob += dt * target.HorizontalSpeed * 1.6f;
            float bobAmount = target.Grounded ? Mathf.Min(1f, target.HorizontalSpeed / 6f) * 0.012f : 0f;
            bool aiming = target.Weapons.IsAiming;
            Vector3 basePos = aiming ? new Vector3(0f, -0.14f, 0.3f) : new Vector3(0.2f, -0.2f, 0.32f);
            float equip = target.Weapons.EquipTimeLeft > 0f ? 0.15f : 0f;
            float reload = target.Weapons.IsReloading ? 0.1f : 0f;
            viewModel.localPosition = basePos + new Vector3(Mathf.Sin(bob) * bobAmount, Mathf.Abs(Mathf.Cos(bob)) * bobAmount - equip - reload, -kick * 0.06f);
            viewModel.localRotation = Quaternion.Euler(-kick * 6f + reload * 150f, 0f, 0f);
        }
    }
}
