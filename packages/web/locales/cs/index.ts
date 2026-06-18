import { defineCatalog } from '../defineCatalog'
import { personalData } from './personalData'
import { strings } from './strings'

export const cs = defineCatalog(
  'cs',
  'cs',
  strings,
  {
    planNames: {
      monthly: 'Měsíční',
      yearly: 'Roční',
      club: 'Klubové předplatné',
    },
    roleLabels: {
      super_admin: 'Vlastník',
      admin: 'Administrátor',
      editor: 'Editor',
      analyst: 'Analytik',
      moderator: 'Moderátor',
      viewer: 'Divák',
    },
  },
  personalData,
)
