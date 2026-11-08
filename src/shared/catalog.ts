// Project types, versions and defaults offered when creating a project.
export interface ProjectType {
  value: string
  label: string
  docroot: string
  scaffold?: string[]
}

export const PROJECT_TYPES: ProjectType[] = [
  { value: 'php', label: 'PHP', docroot: '' },
  { value: 'laravel', label: 'Laravel', docroot: 'public', scaffold: ['ddev', 'composer', 'create-project', 'laravel/laravel'] },
  { value: 'wordpress', label: 'WordPress', docroot: '', scaffold: ['ddev', 'wp', 'core', 'download'] },
  { value: 'symfony', label: 'Symfony', docroot: 'public', scaffold: ['ddev', 'composer', 'create-project', 'symfony/skeleton'] },
  { value: 'drupal11', label: 'Drupal 11', docroot: 'web', scaffold: ['ddev', 'composer', 'create-project', 'drupal/recommended-project:^11'] },
  { value: 'codeigniter', label: 'CodeIgniter 4', docroot: 'public', scaffold: ['ddev', 'composer', 'create-project', 'codeigniter4/appstarter'] },
  { value: 'cakephp', label: 'CakePHP', docroot: 'webroot', scaffold: ['ddev', 'composer', 'create-project', 'cakephp/app'] },
  { value: 'craftcms', label: 'Craft CMS', docroot: 'web', scaffold: ['ddev', 'composer', 'create-project', 'craftcms/craft'] },
  { value: 'magento2', label: 'Magento 2', docroot: 'pub' },
  { value: 'node', label: 'Node.js (Express, Vite, monorepo…)', docroot: '' },
  { value: 'generic', label: 'Generic (no PHP)', docroot: '' }
]

export const PHP_VERSIONS = ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4', '7.3', '7.2', '7.1', '7.0', '5.6']
export const NODE_VERSIONS = ['24', '22', '20', '18', '25']
export const WEBSERVERS = [
  { value: 'apache-fpm', label: 'Apache' },
  { value: 'nginx-fpm', label: 'nginx' }
]
export const DATABASES = [
  { value: 'mariadb:11.8', label: 'MariaDB 11.8' },
  { value: 'mariadb:10.11', label: 'MariaDB 10.11' },
  { value: 'mysql:8.4', label: 'MySQL 8.4' },
  { value: 'mysql:8.0', label: 'MySQL 8.0' },
  { value: 'postgres:18', label: 'PostgreSQL 18' },
  { value: 'postgres:17', label: 'PostgreSQL 17' }
]
export const DEFAULTS = { php: '8.4', node: '24', webserver: 'apache-fpm', db: 'mariadb:11.8' }
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/
