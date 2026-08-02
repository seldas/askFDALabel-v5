import sys
import os
from pathlib import Path

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent
sys.path.append(str(root_dir / 'backend'))

from dashboard import create_app
from database import db, Favorite, Project, User

app = create_app()
with app.app_context():
    # Check for favorites with project_id = None
    orphans = Favorite.query.filter_by(project_id=None).all()
    print(f"Orphaned favorites (project_id=None): {len(orphans)}")
    
    # Check if any favorites belong to non-existent projects
    all_favs = Favorite.query.all()
    invalid_project_favs = 0
    for fav in all_favs:
        if fav.project_id:
            proj = Project.query.get(fav.project_id)
            if not proj:
                invalid_project_favs += 1
    print(f"Favorites with invalid project_id: {invalid_project_favs}")
    
    # Check consistency between favorite.user_id and project.owner_id
    # Note: A favorite could be added by a contributor, so user_id != owner_id is possible.
    # But usually for single-user setup they match.
    mismatch_owner = 0
    for fav in all_favs:
        if fav.project_id:
            proj = Project.query.get(fav.project_id)
            if proj and proj.owner_id != fav.user_id:
                # Check if it's a shared project
                if fav.user not in proj.members:
                    mismatch_owner += 1
    print(f"Favorites added to projects where user is not owner/member: {mismatch_owner}")
