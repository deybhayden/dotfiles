# get standard config object
c = get_config()

# load extensions
c.InteractiveShellApp.extensions = ['autoreload', 'line_profiler']

# shell configuration
c.InteractiveShell.autoindent = True
c.InteractiveShell.colors = 'Linux'
c.InteractiveShell.confirm_exit = False
c.InteractiveShell.deep_reload = True
c.InteractiveShell.editor = 'vim'
c.InteractiveShell.xmode = 'Context'
c.PromptManager.justify = True
c.PrefilterManager.multi_line_specials = True
