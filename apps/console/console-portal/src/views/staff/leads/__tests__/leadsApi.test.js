import { describe, it, expect } from 'vitest'
import { buildListQuery } from '../leadsApi'

describe('buildListQuery', () => {
  it('bandeja "all" sin filtros → solo limit', () => {
    expect(buildListQuery('all', {})).toBe('limit=200')
  })
  it('bandeja "mine" → assignedTo=me', () => {
    expect(buildListQuery('mine', {})).toBe('assignedTo=me&limit=200')
  })
  it('bandeja "unassigned" → assignedTo=none', () => {
    expect(buildListQuery('unassigned', {})).toBe('assignedTo=none&limit=200')
  })
  it('bandeja "followup" → followUpDue=true', () => {
    expect(buildListQuery('followup', {})).toBe('followUpDue=true&limit=200')
  })
  it('status ALL se omite; un status concreto se incluye', () => {
    expect(buildListQuery('all', { status: 'ALL' })).toBe('limit=200')
    expect(buildListQuery('all', { status: 'won' })).toBe('status=won&limit=200')
  })
  it('q se codifica', () => {
    expect(buildListQuery('all', { q: 'ana & co' })).toContain('q=ana+%26+co')
  })
})
