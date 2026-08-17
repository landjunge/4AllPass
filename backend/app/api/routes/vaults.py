from fastapi import APIRouter, status

from app.api.deps import AccountDep, SessionDep, SettingsDep, VaultDep
from app.api.serializers import snapshot_to_wire, vault_to_response
from app.schemas.api import SnapshotCommitRequest, SnapshotResponse, VaultResponse
from app.services import vaults as vault_service

router = APIRouter(prefix="/vaults", tags=["vaults"])


@router.post("", response_model=VaultResponse, status_code=status.HTTP_201_CREATED)
async def create_vault(session: SessionDep, account: AccountDep) -> VaultResponse:
    """Reserve a vault id. The client needs it before it can build any AAD."""
    vault = await vault_service.create_vault(session, account.id)
    return vault_to_response(vault)


@router.get("", response_model=list[VaultResponse])
async def list_vaults(session: SessionDep, account: AccountDep) -> list[VaultResponse]:
    vaults = await vault_service.list_vaults(session, account.id)
    return [vault_to_response(vault) for vault in vaults]


@router.get("/{vault_id}", response_model=VaultResponse)
async def get_vault(vault: VaultDep) -> VaultResponse:
    return vault_to_response(vault)


@router.get("/{vault_id}/snapshot", response_model=SnapshotResponse, response_model_exclude_none=True)
async def get_active_snapshot(vault: VaultDep, session: SessionDep) -> SnapshotResponse:
    """The snapshot named by `active_revision`, never a mix of revisions."""
    snapshot = await vault_service.get_active_snapshot(session, vault)
    return snapshot_to_wire(snapshot)


@router.post(
    "/{vault_id}/snapshots",
    response_model=SnapshotResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def commit_snapshot(
    payload: SnapshotCommitRequest,
    vault: VaultDep,
    session: SessionDep,
    settings: SettingsDep,
) -> SnapshotResponse:
    """Write revision N+1 in full, then compare-and-set `active_revision`."""
    snapshot = await vault_service.commit_snapshot(session, vault, payload, settings)
    return snapshot_to_wire(snapshot)
