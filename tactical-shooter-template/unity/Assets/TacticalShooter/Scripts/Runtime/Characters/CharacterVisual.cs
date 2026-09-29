using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// The placeholder body: capsule torso in team colour, sphere head, agent-coloured visor and
    /// chest band, a box for the gun and a red backpack while carrying the bomb.
    ///
    /// This is the single swap point for real character art: build your prefab here instead and
    /// keep the public methods. Gameplay never reads the model - hit zones come from the
    /// CharacterController height (GAME_RULES.md 4.1), not from the mesh.
    /// </summary>
    public sealed class CharacterVisual
    {
        readonly TacticalCharacter owner;
        readonly Transform root;
        readonly Transform gunPivot;
        readonly GameObject gun;
        readonly GameObject pack;
        readonly Renderer[] renderers;
        readonly float standHeight;
        bool hidden;

        public CharacterVisual(TacticalCharacter owner, Color team, Color agent, Color skin, Color bomb, float standHeight)
        {
            this.owner = owner;
            this.standHeight = standHeight;
            root = new GameObject("Model").transform;
            root.SetParent(owner.transform, false);

            Prims.Shape(PrimitiveType.Capsule, root, new Vector3(0f, 0.72f, 0f), new Vector3(0.66f, 0.72f, 0.5f), team, "Body");
            Prims.Shape(PrimitiveType.Cube, root, new Vector3(0f, 1.12f, 0f), new Vector3(0.68f, 0.12f, 0.52f), agent, "Band");
            Prims.Shape(PrimitiveType.Sphere, root, new Vector3(0f, 1.6f, 0f), new Vector3(0.36f, 0.38f, 0.36f), skin, "Head");
            Prims.Shape(PrimitiveType.Cube, root, new Vector3(0f, 1.63f, 0.15f), new Vector3(0.3f, 0.08f, 0.12f), agent, "Visor");
            gunPivot = new GameObject("GunPivot").transform;
            gunPivot.SetParent(root, false);
            gunPivot.localPosition = new Vector3(0.24f, 1.32f, 0.1f);
            gun = Prims.Shape(PrimitiveType.Cube, gunPivot, new Vector3(0f, 0f, 0.3f), new Vector3(0.07f, 0.1f, 0.55f), Color.black, "Gun");
            pack = Prims.Shape(PrimitiveType.Cube, root, new Vector3(0f, 1.05f, -0.32f), new Vector3(0.36f, 0.42f, 0.16f), bomb, "BombPack");
            pack.SetActive(false);
            renderers = root.GetComponentsInChildren<Renderer>(true);
        }

        public void Tick()
        {
            float h = owner.Height / standHeight;
            root.localScale = new Vector3(1f, owner.Alive ? h : 1f, 1f);
            gunPivot.localRotation = Quaternion.Euler(-owner.ViewPitch, 0f, 0f);
        }

        public void SetWeapon(WeaponDef def)
        {
            if (def == null) return;
            Prims.SetColor(gun, Prims.ToColor(def.color));
            float length = def.Category == WeaponCategory.Melee ? 0.25f
                         : def.Category == WeaponCategory.Sidearm ? 0.28f
                         : def.Category == WeaponCategory.Sniper ? 0.95f : 0.6f;
            gun.transform.localScale = new Vector3(0.07f, 0.1f, length);
            gun.transform.localPosition = new Vector3(0f, 0f, length / 2f);
        }

        public void SetBomb(bool carrying) => pack.SetActive(carrying);

        public void SetAlive(bool alive)
        {
            root.localRotation = alive ? Quaternion.identity : Quaternion.Euler(-80f, 0f, 0f);
            root.localPosition = alive ? Vector3.zero : new Vector3(0f, 0.25f, 0f);
            gunPivot.gameObject.SetActive(alive);
            if (!alive) SetHidden(false);
        }

        /// <summary>Hides the body for the first-person camera that is looking out of it.</summary>
        public void SetHidden(bool value)
        {
            if (hidden == value) return;
            hidden = value;
            foreach (var r in renderers) if (r != null) r.enabled = !value;
        }
    }
}
