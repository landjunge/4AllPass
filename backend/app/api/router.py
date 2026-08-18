from fastapi import APIRouter

from app.api.routes import auth, devices, health, vaults

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(vaults.router)
api_router.include_router(devices.router)
