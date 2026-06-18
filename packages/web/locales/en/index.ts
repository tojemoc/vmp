import { defineCatalog } from '../defineCatalog'
import { personalData } from './personalData'
import { strings } from './strings'

export const en = defineCatalog(
  'en',
  'en',
  strings,
  {
    planNames: {
      monthly: 'Monthly',
      yearly: 'Yearly',
      club: 'Club membership',
    },
    roleLabels: {
      super_admin: 'Owner',
      admin: 'Admin',
      editor: 'Editor',
      analyst: 'Analyst',
      moderator: 'Mod',
      viewer: 'Viewer',
    },
  },
  personalData,
)
