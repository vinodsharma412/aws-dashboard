"""API v1 router — assembles all endpoint sub-routers under ``/api/v1``.

Adding a new feature:
    1. Create ``backend/app/api/v1/endpoints/your_feature.py``
    2. ``from app.api.v1.endpoints import your_feature``
    3. ``api_router.include_router(your_feature.router, prefix="/your-feature", tags=["YourFeature"])``
    4. Add the CRUD module under ``backend/app/crud/`` if it needs DB access.
    5. Add the schema under ``backend/app/schemas/`` for request/response types.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import auth, health, menu, scraping, stocks, users

api_router = APIRouter()

# fmt: off
api_router.include_router(auth.router,     prefix="/auth",     tags=["Auth"])
api_router.include_router(users.router,    prefix="/users",    tags=["Users"])
api_router.include_router(menu.router,     prefix="/menus",    tags=["Menus"])
api_router.include_router(stocks.router,   prefix="/stocks",   tags=["Stocks"])
api_router.include_router(scraping.router, prefix="/scraping", tags=["Scraping"])
api_router.include_router(health.router,   prefix="/health",   tags=["Health"])
# fmt: on
