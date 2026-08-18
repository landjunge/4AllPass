from httpx import AsyncClient


async def test_health_reports_dependencies(client: AsyncClient, api: str) -> None:
    response = await client.get(f"{api}/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True
    assert body["redis"] is True
    assert body["crypto_protocol_version"] == 1


async def test_openapi_documents_the_zero_knowledge_contract(client: AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()
    assert "never sees a master password" in schema["info"]["description"]
    paths = schema["paths"]
    assert "/api/v1/vaults/{vault_id}/snapshots" in paths
    assert (
        "/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{credential_id}/device-key-envelope"
        in paths
    )
