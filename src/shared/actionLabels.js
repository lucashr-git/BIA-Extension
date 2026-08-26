function targetDesc(a) {
  if (a.target?.index !== undefined) return `elemento [${a.target.index}]`;
  if (a.target?.text) return `"${a.target.text}"`;
  if (a.selector) return `"${a.selector}"`;
  return 'elemento';
}

const LABELS = {
  navigate:               { live: (a) => `Navegando para ${a.url}`,                                          done: (a) => `Navegou para ${a.url || ''}` },
  go_back:                { live: ()  => `Voltando para a página anterior`,                                  done: ()  => `Voltou para a página anterior` },
  click:                  { live: (a) => `Clicando em ${targetDesc(a)}`,                                     done: (a) => `Clicou em ${targetDesc(a)}` },
  hover:                  { live: (a) => `Passando mouse em ${targetDesc(a)}`,                               done: (a) => `Hover em ${targetDesc(a)}` },
  type:                   { live: (a) => `Digitando "${a.text}" em ${targetDesc(a)}`,                        done: (a) => `Digitou "${a.text}" em ${targetDesc(a)}` },
  fill:                   { live: (a) => `Preenchendo ${targetDesc(a)} com "${a.text || a.value}"`,          done: (a) => `Preencheu ${targetDesc(a)} com "${a.text || a.value}"` },
  clear:                  { live: (a) => `Limpando campo ${targetDesc(a)}`,                                  done: (a) => `Limpou o campo ${targetDesc(a)}` },
  press_enter:            { live: (a) => `Pressionando Enter em ${targetDesc(a)}`,                           done: (a) => `Pressionou Enter em ${targetDesc(a)}` },
  check_checkbox:         { live: (a) => `${a.checked === false ? 'Desmarcando' : 'Marcando'} ${targetDesc(a)}`, done: (a) => `${a.checked === false ? 'Desmarcou' : 'Marcou'} ${targetDesc(a)}` },
  search:                 { live: (a) => `Buscando "${a.text}"`,                                             done: (a) => `Buscou "${a.text}"` },
  scroll:                 { live: (a) => a.position ? `Rolando até o ${a.position === 'top' ? 'topo' : 'fim'}` : `Rolando ${a.direction === 'up' ? 'para cima' : 'para baixo'}`,
                            done: (a) => a.position ? `Rolou até o ${a.position === 'top' ? 'topo' : 'fim'}` : `Rolou ${a.direction === 'up' ? '↑ para cima' : '↓ para baixo'}` },
  scroll_to:              { live: (a) => `Indo até ${targetDesc(a)}`,                                        done: (a) => `Rolou até ${targetDesc(a)}` },
  scroll_to_text:         { live: (a) => `Rolando até o texto "${a.text}"`,                                  done: (a) => `Rolou até o texto "${a.text}"` },
  find:                   { live: (a) => `Procurando "${a.text || a.query}" na página`,                      done: (a) => `Procurou "${a.text || a.query}" na página` },
  send_keys:              { live: (a) => `Enviando teclas ${a.keys || a.key}`,                               done: (a) => `Enviou teclas ${a.keys || a.key}` },
  key:                    { live: (a) => `Pressionando ${a.key}`,                                            done: (a) => `Tecla ${a.key}` },
  wait:                   { live: (a) => `Aguardando ${a.ms || 1000}ms`,                                     done: (a) => `Aguardou ${a.ms || 1000}ms` },
  get_links:              { live: (a) => `Coletando links${a.filter ? ' de "' + a.filter + '"' : ''}`,       done: (a) => `Coletou links${Array.isArray(a.result) ? ` (${a.result.length})` : ''}` },
  get_errors:             { live: ()  => `Verificando erros de console e rede`,                              done: ()  => `Verificou erros de console e rede` },
  get_network_requests:   { live: (a) => `Listando requisições de rede${a.filter ? ` com "${a.filter}"` : ''}`, done: (a) => `Listou requisições de rede${a.filter ? ` com "${a.filter}"` : ''}` },
  assert_network_request: { live: (a) => `Validando requisição "${a.urlIncludes}"${a.status ? ` → ${a.status}` : ''}`, done: (a) => `Verificou requisição "${a.urlIncludes}"${a.status ? ` → ${a.status}` : ''}` },
  wait_for_network_idle:  { live: ()  => `Aguardando a rede ficar ociosa`,                                   done: ()  => `Aguardou a rede ficar ociosa` },
  accessibility_audit:    { live: ()  => `Auditando acessibilidade (axe-core)`,                              done: ()  => `Auditou acessibilidade (axe-core)` },
  get_dropdown_options:   { live: (a) => `Lendo opções do dropdown ${targetDesc(a)}`,                        done: (a) => `Leu opções do dropdown ${targetDesc(a)}` },
  select_dropdown_option: { live: (a) => `Selecionando "${a.optionText || a.value}" em ${targetDesc(a)}`,    done: (a) => `Selecionou "${a.optionText || a.value}" em ${targetDesc(a)}` },
  select:                 { live: (a) => `Selecionando opção "${a.value}" em ${targetDesc(a)}`,              done: (a) => `Selecionou "${a.value}" em ${targetDesc(a)}` },
  wait_for_selector:      { live: (a) => `Aguardando seletor ${a.selector}`,                                 done: (a) => `Aguardou seletor ${a.selector}` },
  wait_for_text:          { live: (a) => `Aguardando texto "${a.text}"`,                                     done: (a) => `Aguardou texto "${a.text}"` },
  assert_url_includes:    { live: (a) => `Validando URL contém "${a.part}"`,                                 done: (a) => `Verificou URL contém "${a.part}"` },
  assert_text:            { live: (a) => `Validando texto em ${targetDesc(a)}`,                              done: (a) => `Verificou texto "${a.text}"${a.selector ? ` em "${a.selector}"` : ' na página'}` },
  extract_text:           { live: (a) => `Extraindo texto de ${targetDesc(a)}`,                              done: (a) => `Extraiu texto de ${targetDesc(a)}` },
  get_attribute:          { live: (a) => `Lendo atributo "${a.attribute}" de ${targetDesc(a)}`,              done: (a) => `Leu atributo "${a.attribute}" de ${targetDesc(a)}` },
  get_css:                { live: (a) => `Lendo CSS de ${targetDesc(a)}${a.property ? ' → ' + a.property : ''}`, done: (a) => `Leu CSS de ${targetDesc(a)}` },
  screenshot:             { live: ()  => `Capturando screenshot`,                                            done: ()  => `Screenshot capturada` },
  deferred_batch:         { live: (a) => `${a.count} ação(ões) adiadas após a navegação`,                    done: (a) => `${a.count} ação(ões) adiadas após a navegação` },
};

export function liveLabel(a) {
  return LABELS[a.type] ? LABELS[a.type].live(a) : a.type;
}

export function doneLabel(a) {
  return LABELS[a.type] ? LABELS[a.type].done(a) : a.type;
}
