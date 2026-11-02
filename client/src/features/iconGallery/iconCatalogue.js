import {
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, ArrowDown, ArrowDownRight, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp,
  ArrowUpDown, ArrowUpRight, AtSign, Award, Bell, Book, Bookmark, BookOpen, Bot, Brain, Briefcase, Brush, Bug, Building, Building2,
  Calculator, Calendar, ChartBar, ChartLine, ChartPie, ChevronRight, Circle, CircleAlert, CircleCheck, CircleX, Clipboard, ClipboardList,
  Clock, Cloud, CloudDownload, CloudUpload, Code, Columns3, CornerDownRight, Cpu, CreditCard, Crop, Database, DollarSign, Download, Eye,
  Factory, Filter, FlaskConical, Flag, Frame, Gift, GitBranch, GitMerge, GitPullRequest, Globe, GraduationCap, Grid3x3, Handshake,
  HardDrive, Heart, Hexagon, Hourglass, House, Image, Inbox, Info, Key, Keyboard, Landmark, Laptop, Layers, LayoutDashboard, LayoutGrid,
  Library, Lightbulb, Link, Lock, Mail, MapPin, Megaphone, MessageCircle, MessageSquare, Microscope, Monitor, Moon, Mouse, Move, Network,
  Notebook, Package, Palette, PanelsTopLeft, Pencil, PenTool, Phone, Presentation, Printer, Receipt, Redo2, RefreshCw, Repeat, Rocket,
  Route, Rows3, Rss, Ruler, School, Search, Send, Server, Settings, Shapes, Share, Share2, Shield, ShoppingCart, Smartphone, Square, Star,
  Store, Sun, Tablet, Tag, Target, Terminal, ThumbsUp, Timer, Trash2, TrendingDown, TrendingUp, Triangle, Truck, Type, Undo2, Upload,
  User, UserPlus, Users, Video, Wallet, Wifi, Workflow, Zap
} from 'lucide-react';

export const ICON_CATEGORIES = Object.freeze([
  { id: 'technology', labelKey: 'icons.category.technology' },
  { id: 'business', labelKey: 'icons.category.business' },
  { id: 'communication', labelKey: 'icons.category.communication' },
  { id: 'education', labelKey: 'icons.category.education' },
  { id: 'arrows', labelKey: 'icons.category.arrows' },
  { id: 'general', labelKey: 'icons.category.general' },
  { id: 'design', labelKey: 'icons.category.design' }
]);

const DEFINITIONS = {
  technology: [
    [Laptop, 'laptop', 'Laptop', 'computer notebook device pc'],
    [Monitor, 'monitor', 'Monitor', 'computer screen display desktop device laptop'],
    [Smartphone, 'smartphone', 'Smartphone', 'phone mobile device cell laptop'],
    [Tablet, 'tablet', 'Tablet', 'ipad device screen computer laptop'],
    [Database, 'database', 'Database', 'data storage sql records table db'],
    [Server, 'server', 'Server', 'storage hosting backend rack computer'],
    [HardDrive, 'hard-drive', 'Hard Drive', 'storage disk drive backup data'],
    [Cloud, 'cloud', 'Cloud', 'storage hosting online weather sky'],
    [CloudUpload, 'cloud-upload', 'Cloud Upload', 'storage upload sync backup'],
    [CloudDownload, 'cloud-download', 'Cloud Download', 'storage download sync'],
    [Cpu, 'cpu', 'CPU', 'processor chip hardware computer'],
    [Code, 'code', 'Code', 'programming developer source html brackets'],
    [Terminal, 'terminal', 'Terminal', 'console command line shell prompt'],
    [Network, 'network', 'Network', 'connection topology nodes lan infrastructure'],
    [Wifi, 'wifi', 'Wi-Fi', 'wireless internet connection signal network'],
    [Keyboard, 'keyboard', 'Keyboard', 'typing input computer device laptop'],
    [Mouse, 'mouse', 'Mouse', 'pointer input computer device'],
    [Printer, 'printer', 'Printer', 'print paper device office'],
    [Bot, 'bot', 'Bot', 'robot ai assistant automation'],
    [Globe, 'globe', 'Globe', 'web internet world earth website'],
    [Lock, 'lock', 'Lock', 'security secure password private'],
    [Shield, 'shield', 'Shield', 'security protection safe defence'],
    [Key, 'key', 'Key', 'password access security credential'],
    [Bug, 'bug', 'Bug', 'issue error defect debug insect']
  ],
  business: [
    [Briefcase, 'briefcase', 'Briefcase', 'work job business portfolio office'],
    [Building, 'building', 'Building', 'office company organisation city'],
    [Building2, 'building-2', 'Office Building', 'company headquarters enterprise organisation'],
    [ChartBar, 'chart-bar', 'Bar Chart', 'graph statistics analytics report data'],
    [ChartLine, 'chart-line', 'Line Chart', 'graph trend analytics report data'],
    [ChartPie, 'chart-pie', 'Pie Chart', 'graph share statistics analytics data'],
    [TrendingUp, 'trending-up', 'Trending Up', 'growth increase profit chart rise'],
    [TrendingDown, 'trending-down', 'Trending Down', 'decline decrease loss chart fall'],
    [Wallet, 'wallet', 'Wallet', 'money payment finance cash'],
    [CreditCard, 'credit-card', 'Credit Card', 'payment money bank finance purchase'],
    [DollarSign, 'dollar-sign', 'Dollar', 'money currency price finance cost'],
    [Receipt, 'receipt', 'Receipt', 'invoice bill payment purchase'],
    [Handshake, 'handshake', 'Handshake', 'deal agreement partnership meeting'],
    [Store, 'store', 'Store', 'shop retail market business'],
    [ShoppingCart, 'shopping-cart', 'Shopping Cart', 'shop buy purchase ecommerce basket'],
    [Package, 'package', 'Package', 'box parcel delivery product shipping'],
    [Truck, 'truck', 'Truck', 'delivery shipping logistics transport'],
    [Factory, 'factory', 'Factory', 'manufacturing industry production plant'],
    [Landmark, 'landmark', 'Bank', 'bank finance government institution'],
    [Award, 'award', 'Award', 'prize achievement badge winner']
  ],
  communication: [
    [Mail, 'mail', 'Mail', 'email message letter envelope inbox'],
    [MessageCircle, 'message-circle', 'Message Circle', 'chat comment conversation bubble'],
    [MessageSquare, 'message-square', 'Message Square', 'chat comment conversation feedback'],
    [Phone, 'phone', 'Phone', 'call telephone contact'],
    [Video, 'video', 'Video', 'camera call meeting record film'],
    [Send, 'send', 'Send', 'submit message paper plane share'],
    [Bell, 'bell', 'Bell', 'notification alert alarm reminder'],
    [Users, 'users', 'Users', 'people team group members audience'],
    [User, 'user', 'User', 'person profile account member'],
    [UserPlus, 'user-plus', 'Add User', 'invite person member join'],
    [Share, 'share', 'Share', 'export send forward'],
    [Share2, 'share-2', 'Share Network', 'social share connect nodes'],
    [AtSign, 'at-sign', 'At Sign', 'email mention handle address'],
    [Megaphone, 'megaphone', 'Megaphone', 'announcement marketing broadcast loud'],
    [Rss, 'rss', 'RSS', 'feed news subscribe blog'],
    [Inbox, 'inbox', 'Inbox', 'mail messages tray received']
  ],
  education: [
    [BookOpen, 'book-open', 'Book Open', 'reading study learn documentation'],
    [Book, 'book', 'Book', 'reading study learn library'],
    [GraduationCap, 'graduation-cap', 'Graduation Cap', 'education school university student degree'],
    [Pencil, 'pencil', 'Pencil', 'write edit draw note'],
    [Notebook, 'notebook', 'Notebook', 'notes journal study writing'],
    [Library, 'library', 'Library', 'books collection archive study'],
    [Presentation, 'presentation', 'Presentation', 'slides board lecture meeting teach'],
    [Clipboard, 'clipboard', 'Clipboard', 'paste document notes board'],
    [ClipboardList, 'clipboard-list', 'Checklist', 'tasks todo list plan clipboard'],
    [School, 'school', 'School', 'education building campus learn'],
    [Bookmark, 'bookmark', 'Bookmark', 'save favourite mark read later'],
    [Lightbulb, 'lightbulb', 'Lightbulb', 'idea insight innovation tip bright'],
    [Brain, 'brain', 'Brain', 'mind thinking intelligence knowledge'],
    [FlaskConical, 'flask-conical', 'Flask', 'science chemistry lab experiment'],
    [Microscope, 'microscope', 'Microscope', 'science research lab biology'],
    [Calculator, 'calculator', 'Calculator', 'maths numbers accounting compute']
  ],
  arrows: [
    [ArrowRight, 'arrow-right', 'Arrow Right', 'direction next forward east'],
    [ArrowLeft, 'arrow-left', 'Arrow Left', 'direction back previous west'],
    [ArrowUp, 'arrow-up', 'Arrow Up', 'direction north increase top'],
    [ArrowDown, 'arrow-down', 'Arrow Down', 'direction south decrease bottom'],
    [ArrowUpRight, 'arrow-up-right', 'Arrow Up Right', 'direction diagonal external link growth'],
    [ArrowDownRight, 'arrow-down-right', 'Arrow Down Right', 'direction diagonal'],
    [ArrowLeftRight, 'arrow-left-right', 'Arrow Left Right', 'direction swap exchange horizontal'],
    [ArrowUpDown, 'arrow-up-down', 'Arrow Up Down', 'direction sort vertical swap'],
    [ChevronRight, 'chevron-right', 'Chevron Right', 'arrow next caret direction'],
    [CornerDownRight, 'corner-down-right', 'Corner Down Right', 'arrow turn reply direction'],
    [Move, 'move', 'Move', 'arrows drag position pan direction'],
    [Workflow, 'workflow', 'Workflow', 'flow process diagram steps automation'],
    [GitBranch, 'git-branch', 'Git Branch', 'branch version control flow fork'],
    [GitMerge, 'git-merge', 'Git Merge', 'merge version control flow join'],
    [GitPullRequest, 'git-pull-request', 'Pull Request', 'review version control flow'],
    [Route, 'route', 'Route', 'path journey flow map direction'],
    [Link, 'link', 'Link', 'url chain connect hyperlink'],
    [Repeat, 'repeat', 'Repeat', 'loop cycle again arrow'],
    [RefreshCw, 'refresh-cw', 'Refresh', 'reload sync update arrow cycle'],
    [Undo2, 'undo-2', 'Undo', 'back revert arrow history'],
    [Redo2, 'redo-2', 'Redo', 'forward repeat arrow history']
  ],
  general: [
    [Calendar, 'calendar', 'Calendar', 'date schedule event day plan'],
    [Clock, 'clock', 'Clock', 'time hour schedule watch'],
    [Timer, 'timer', 'Timer', 'stopwatch time countdown duration'],
    [Hourglass, 'hourglass', 'Hourglass', 'time waiting loading duration'],
    [MapPin, 'map-pin', 'Map Pin', 'location place marker address'],
    [Target, 'target', 'Target', 'goal aim objective focus'],
    [CircleCheck, 'circle-check', 'Check Circle', 'done complete success tick yes'],
    [CircleX, 'circle-x', 'Cross Circle', 'cancel close error no remove'],
    [CircleAlert, 'circle-alert', 'Alert Circle', 'warning error attention caution'],
    [Info, 'info', 'Info', 'information help details about'],
    [Settings, 'settings', 'Settings', 'gear cog preferences configuration'],
    [Search, 'search', 'Search', 'find magnifier lookup zoom'],
    [Star, 'star', 'Star', 'favourite rating bookmark important'],
    [Heart, 'heart', 'Heart', 'love like favourite health'],
    [Flag, 'flag', 'Flag', 'milestone report mark country'],
    [House, 'house', 'Home', 'home house main start'],
    [Trash2, 'trash-2', 'Trash', 'delete remove bin rubbish'],
    [Eye, 'eye', 'Eye', 'view visible watch preview'],
    [Download, 'download', 'Download', 'save arrow export'],
    [Upload, 'upload', 'Upload', 'import arrow send'],
    [Filter, 'filter', 'Filter', 'funnel sort refine'],
    [Tag, 'tag', 'Tag', 'label price category'],
    [Zap, 'zap', 'Lightning', 'flash power energy fast'],
    [Sun, 'sun', 'Sun', 'light day weather bright'],
    [Moon, 'moon', 'Moon', 'night dark sleep'],
    [Gift, 'gift', 'Gift', 'present reward surprise'],
    [Rocket, 'rocket', 'Rocket', 'launch startup fast space'],
    [ThumbsUp, 'thumbs-up', 'Thumbs Up', 'like approve agree yes']
  ],
  design: [
    [LayoutGrid, 'layout-grid', 'Layout Grid', 'grid tiles dashboard arrangement'],
    [LayoutDashboard, 'layout-dashboard', 'Dashboard Layout', 'panels dashboard arrangement'],
    [PanelsTopLeft, 'panels-top-left', 'Panels', 'layout window sidebar sections'],
    [Layers, 'layers', 'Layers', 'stack levels arrange order'],
    [Frame, 'frame', 'Frame', 'artboard crop border layout'],
    [Shapes, 'shapes', 'Shapes', 'geometry circle square triangle'],
    [Palette, 'palette', 'Palette', 'colour paint art design'],
    [Ruler, 'ruler', 'Ruler', 'measure dimensions scale'],
    [AlignHorizontalJustifyCenter, 'align-horizontal-justify-center', 'Align Horizontal', 'align centre distribute layout'],
    [AlignVerticalJustifyCenter, 'align-vertical-justify-center', 'Align Vertical', 'align middle distribute layout'],
    [Grid3x3, 'grid-3x3', 'Grid', 'table cells matrix layout'],
    [Columns3, 'columns-3', 'Columns', 'layout split vertical sections'],
    [Rows3, 'rows-3', 'Rows', 'layout split horizontal sections'],
    [PenTool, 'pen-tool', 'Pen Tool', 'vector bezier draw design'],
    [Brush, 'brush', 'Brush', 'paint draw art'],
    [Crop, 'crop', 'Crop', 'trim cut resize image'],
    [Image, 'image', 'Image', 'picture photo graphic'],
    [Type, 'type', 'Type', 'text font typography letter'],
    [Square, 'square', 'Square', 'shape box rectangle'],
    [Circle, 'circle', 'Circle', 'shape round dot'],
    [Triangle, 'triangle', 'Triangle', 'shape warning delta'],
    [Hexagon, 'hexagon', 'Hexagon', 'shape polygon']
  ]
};

export const ICON_CATALOGUE = Object.freeze(Object.entries(DEFINITIONS).flatMap(([category, icons]) => icons
  .filter(([Icon]) => Boolean(Icon))
  .map(([Icon, id, name, keywords]) => Object.freeze({ id, name, category, keywords, Icon }))));

const SEARCH_INDEX = ICON_CATALOGUE.map((icon) => ({
  icon,
  name: icon.name.toLowerCase(),
  terms: `${icon.name} ${icon.id.replace(/-/g, ' ')} ${icon.keywords}`.toLowerCase()
}));

export const searchIcons = (query = '', category = 'all') => {
  const tokens = String(query).toLowerCase().split(/[\s,]+/).filter(Boolean);
  const ranked = [];
  for (const entry of SEARCH_INDEX) {
    if (category !== 'all' && entry.icon.category !== category) continue;
    if (!tokens.every((token) => entry.terms.includes(token))) continue;
    const first = tokens[0];
    const rank = !first || entry.name.startsWith(first) ? 0 : entry.name.includes(first) ? 1 : 2;
    ranked.push([rank, entry.icon]);
  }
  return ranked.sort((a, b) => a[0] - b[0]).map(([, icon]) => icon);
};
