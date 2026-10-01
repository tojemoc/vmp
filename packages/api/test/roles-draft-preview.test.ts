import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canStaffPreviewUnpublishedVideo,
  isAdministrativeRole,
  isContentEditorRole,
  mayAccessNonPublicVideo,
} from '../src/roles.js';

describe('content editor / draft preview roles', () => {
  it('recognizes editor, admin, and super_admin as content editors', () => {
    assert.equal(isContentEditorRole('editor'), true);
    assert.equal(isContentEditorRole('admin'), true);
    assert.equal(isContentEditorRole('super_admin'), true);
    assert.equal(isContentEditorRole('EDITOR'), true);
  });

  it('rejects viewer, analyst, moderator, and empty roles for content editing', () => {
    assert.equal(isContentEditorRole('viewer'), false);
    assert.equal(isContentEditorRole('analyst'), false);
    assert.equal(isContentEditorRole('moderator'), false);
    assert.equal(isContentEditorRole(''), false);
    assert.equal(isContentEditorRole(null), false);
    assert.equal(isContentEditorRole(undefined), false);
  });

  it('allows staff draft preview only for content editors', () => {
    assert.equal(canStaffPreviewUnpublishedVideo('editor'), true);
    assert.equal(canStaffPreviewUnpublishedVideo('analyst'), false);
    assert.equal(canStaffPreviewUnpublishedVideo('viewer'), false);
  });

  it('keeps analyst in the broader administrative set but not draft preview', () => {
    assert.equal(isAdministrativeRole('analyst'), true);
    assert.equal(mayAccessNonPublicVideo('analyst', false), false);
    assert.equal(mayAccessNonPublicVideo('editor', false), true);
    assert.equal(mayAccessNonPublicVideo('viewer', true), true);
    assert.equal(mayAccessNonPublicVideo(null, false), false);
  });
});
