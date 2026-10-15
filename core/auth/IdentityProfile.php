<?php
declare(strict_types=1);

namespace Takeoff\Core\Auth;

use InvalidArgumentException;

/**
 * Provider-neutral Identity Profile for Takeoff SSO.
 *
 * Represents an authenticated central user identity with strict security invariants:
 * 1. Provider-neutral: models identity independently of specific external providers.
 * 2. Active status: an identity is active ONLY when explicitly asserted active (strict boolean true).
 * 3. Explicit roles: models assigned roles without assigning fallback or default administrator privileges.
 * 4. UserInfo claims: models identity attributes retrieved from userinfo in a provider-neutral structure.
 */
class IdentityProfile
{
    private string $provider;
    private string $sub;
    private bool $active;
    private array $roles;
    private ?string $email;
    private ?string $username;
    private ?string $name;
    private array $attributes;

    /**
     * @param string $provider Central identity provider identifier
     * @param string $sub Central user subject identifier (sub)
     * @param bool $active Account active flag (strictly true only when asserted)
     * @param array $roles Explicit user roles
     * @param string|null $email User email address
     * @param string|null $username Username or display name
     * @param array $attributes Additional provider-neutral claims/attributes
     * @param string|null $name User full name or display name
     */
    public function __construct(
        string $provider,
        string $sub,
        bool $active = false,
        array $roles = [],
        ?string $email = null,
        ?string $username = null,
        array $attributes = [],
        ?string $name = null
    ) {
        if (trim($provider) === '') {
            throw new InvalidArgumentException('Identity profile provider cannot be empty.');
        }

        if (trim($sub) === '') {
            throw new InvalidArgumentException('Identity profile sub cannot be empty.');
        }

        $this->provider = trim($provider);
        $this->sub = trim($sub);

        // Strict invariant: An identity is active ONLY when explicitly asserted active (boolean true)
        $this->active = ($active === true);

        // Clean and normalize roles
        $cleanRoles = [];
        foreach ($roles as $role) {
            if (is_string($role) && trim($role) !== '') {
                $cleanRoles[] = trim($role);
            }
        }
        $this->roles = array_values(array_unique($cleanRoles));

        $this->email = ($email !== null && trim($email) !== '') ? trim($email) : null;
        $this->username = ($username !== null && trim($username) !== '') ? trim($username) : null;
        $this->name = ($name !== null && trim($name) !== '') ? trim($name) : null;
        $this->attributes = $attributes;
    }

    /**
     * Creates an IdentityProfile from a raw claims payload in a provider-neutral manner.
     * Consumes userinfo.sub as the sole canonical central identity identifier.
     * Fails closed when sub is missing, empty, or invalid.
     * Rejects payloads that provide only hub_user_id or another alias.
     * Consumes documented Hub userinfo contract fields (sub, username, display_name, email, active).
     *
     * @param array $claims Raw claims from userinfo endpoint
     * @param string $defaultProvider Default provider name if not specified in claims
     * @return self
     * @throws InvalidArgumentException If sub is missing, empty, or invalid
     */
    public static function fromArray(array $claims, string $defaultProvider = 'hub'): self
    {
        $provider = isset($claims['provider']) && is_string($claims['provider']) && trim($claims['provider']) !== ''
            ? trim($claims['provider'])
            : $defaultProvider;

        // Boundary requires a non-empty sub and rejects payloads that provide only hub_user_id or another alias
        if (!isset($claims['sub']) || (!is_string($claims['sub']) && !is_int($claims['sub'])) || trim((string)$claims['sub']) === '') {
            throw new InvalidArgumentException('Identity profile requires a valid non-empty sub.');
        }
        $sub = trim((string)$claims['sub']);

        // Strict invariant: active ONLY when explicitly boolean true
        $active = isset($claims['active']) && $claims['active'] === true;

        $roles = [];
        if (isset($claims['roles']) && is_array($claims['roles'])) {
            $roles = $claims['roles'];
        }

        $email = null;
        if (isset($claims['email']) && is_string($claims['email']) && trim($claims['email']) !== '') {
            $email = trim($claims['email']);
        }

        $username = null;
        if (isset($claims['username']) && is_string($claims['username']) && trim($claims['username']) !== '') {
            $username = trim($claims['username']);
        }

        $name = null;
        if (isset($claims['display_name']) && is_string($claims['display_name']) && trim($claims['display_name']) !== '') {
            $name = trim($claims['display_name']);
        } elseif (isset($claims['name']) && is_string($claims['name']) && trim($claims['name']) !== '') {
            $name = trim($claims['name']);
        }

        // Consumes exclusively documented Hub userinfo contract claims
        $consumedAttributes = [];
        foreach (['provider', 'sub', 'active', 'roles', 'email', 'username', 'name', 'display_name'] as $key) {
            if (array_key_exists($key, $claims)) {
                $consumedAttributes[$key] = $claims[$key];
            }
        }

        return new self(
            $provider,
            $sub,
            $active,
            $roles,
            $email,
            $username,
            $consumedAttributes,
            $name
        );
    }

    public function getProvider(): string
    {
        return $this->provider;
    }

    public function getSub(): string
    {
        return $this->sub;
    }

    public function getHubUserId(): string
    {
        return $this->sub;
    }

    public function getId(): string
    {
        return $this->sub;
    }

    /**
     * Indicates whether the identity is active.
     * True strictly when asserted active; false by default or when inactive.
     */
    public function isActive(): bool
    {
        return $this->active;
    }

    public function getRoles(): array
    {
        return $this->roles;
    }

    public function hasRole(string $role): bool
    {
        return in_array(trim($role), $this->roles, true);
    }

    public function getEmail(): ?string
    {
        return $this->email;
    }

    public function getUsername(): ?string
    {
        return $this->username;
    }

    public function getName(): ?string
    {
        return $this->name ?? $this->username ?? $this->email ?? $this->sub;
    }

    public function getDisplayName(): ?string
    {
        return $this->name;
    }

    public function getAttributes(): array
    {
        return $this->attributes;
    }

    public function getAttribute(string $key, mixed $default = null): mixed
    {
        return $this->attributes[$key] ?? $default;
    }

    /**
     * Returns the array representation matching the downstream identity contract.
     */
    public function toArray(): array
    {
        return [
            'provider' => $this->provider,
            'sub' => $this->sub,
            'hub_user_id' => $this->sub,
            'active' => $this->active,
            'roles' => $this->roles,
            'email' => $this->email,
            'username' => $this->username,
            'name' => $this->name,
            'display_name' => $this->name,
            'attributes' => $this->attributes,
        ];
    }

    /**
     * Payload compatible with SsoFlow::validateIdentityClaimsContract.
     */
    public function toClaimsContract(): array
    {
        return [
            'provider' => $this->provider,
            'sub' => $this->sub,
            'hub_user_id' => $this->sub,
            'active' => $this->active,
            'roles' => $this->roles,
        ];
    }

    public function __debugInfo(): array
    {
        return $this->toArray();
    }
}

// Global class alias for backward compatibility and flexible resolution
if (!class_exists('IdentityProfile', false)) {
    class_alias(IdentityProfile::class, 'IdentityProfile');
}
