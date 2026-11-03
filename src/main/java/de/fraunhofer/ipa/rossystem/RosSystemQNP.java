package de.fraunhofer.ipa.rossystem;

import org.eclipse.emf.ecore.EObject;
import org.eclipse.xtext.naming.DefaultDeclarativeQualifiedNameProvider;
import org.eclipse.xtext.naming.QualifiedName;
import ros.Parameter;
import system.RosInterface;
import system.RosNode;
import system.RosParameter;
import system.Rossystem;
import system.System;

public class RosSystemQNP extends DefaultDeclarativeQualifiedNameProvider {
  @Override
  public QualifiedName getFullyQualifiedName(final EObject obj) {
    if (obj instanceof RosInterface) {
      EObject container = obj.eContainer();
      if (container instanceof RosNode && ((RosNode) container).getName() != null && !((RosNode) container).getName().isEmpty()) {
        return this.getConverter().toQualifiedName(((RosNode) container).getName() + "::" + ((RosInterface) obj).getName());
      }
      String ifaceName = ((RosInterface) obj).getName();
      return (ifaceName != null && !ifaceName.isEmpty()) ? this.getConverter().toQualifiedName(ifaceName) : null;
    }

    String _switchResult = null;
    boolean _matched = false;
    if (obj instanceof RosNode) {
      _matched = true;
      _switchResult = ((RosNode) obj).getName();
    }
    if (!_matched) {
      if (obj instanceof Rossystem) {
        _matched = true;
        _switchResult = ((Rossystem) obj).getName();
      }
    }
    if (!_matched) {
      if (obj instanceof System) {
        _matched = true;
        _switchResult = ((System) obj).getName();
      }
    }
    if (!_matched) {
      if (obj instanceof Parameter) {
        _matched = true;
        _switchResult = ((Parameter) obj).getName();
      }
    }
    if (!_matched) {
      if (obj instanceof RosParameter) {
        _matched = true;
        _switchResult = ((RosParameter) obj).getName();
      }
    }
    if (_matched) {
      if (_switchResult != null && !_switchResult.isEmpty()) {
        return this.getConverter().toQualifiedName(_switchResult);
      }
    }
    return null;
  }
}
