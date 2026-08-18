-- Added after both tables exist so the pointer can be a real foreign key.
ALTER TABLE reflections
    ADD CONSTRAINT fk_reflection_current_revision
        FOREIGN KEY (current_revision_id)
        REFERENCES reflection_revisions(id)
        ON DELETE SET NULL;
